const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const dotenv = require('dotenv');
const moment = require('moment');
const { exec } = require('child_process');
const path = require('path');
const http = require('http');

const app = express();
const server = http.createServer(app);

var utilisateur = "";
var id_user='';
var dossier_courant="";
var session_ouverte='no'

// Configurer EJS comme moteur de template
app.set('view engine', 'ejs');

//------------------------------------------------------------------------------------------------
// Charger les variables d'environnement
dotenv.config();

// Démarrer le serveur web
server.listen(process.env.WEB_PORT,process.env.WEB_HOST, () => {
    console.log(`Serveur en cours d'exécution sur http://localhost:${process.env.WEB_PORT}`);
});

// Configurer le middleware
app.use(bodyParser.json());
app.use(express.static(__dirname)); // Servir les fichiers statiques (HTML, CSS, JS)

// Configuration du répertoire des fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));

// Route pour les pages HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '.', 'index.html'));
});

app.get('/actions', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'actions.html'));
});

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER, 
    password: process.env.DB_PASSWORD, 
    database: process.env.DB_NAME,
	port: process.env.DB_PORT
});

// Connexion à la base de données
db.connect((err) => {
    if (err) {
        console.error('Erreur de connexion :', err.stack);
        return;
    }
    console.log('Connexion à la base de données réussie en tant que id ', db.threadId);
});

// Utiliser body-parser pour analyser les corps de requête en JSON
app.use(bodyParser.urlencoded({ extended: true }));

//------------------GESTION DE LA PAGE ACCUEIL--------------------------------------------------

app.post('/submit_login', (req, res) => {
	utilisateur = req.body.login;

	const query = `SELECT IFNULL((SELECT id FROM comptes WHERE login = ? LIMIT 1), 'Non trouvé') AS resultat`;
	//console.log("server2.js - utilisateur= ", utilisateur," + query=",query);
	db.query(query, [utilisateur], (err, result) => {
		if (err) throw err;
		//console.log("result=",result);
		if (result[0].resultat==='Non trouvé') {
			res.json({message:`Vous n'êtes pas autorisé à utiliser cette application.<br>Veuillez contacter un administrateur.`});
		} else {
			id_user=result[0].resultat;
			//console.log("id_user=",id_user);
			res.json({ redirect: '/actions' });
		}
	});
});

//------------------GESTION DE LA PAGE ACTIONS--------------------------------------------------

app.get('/getDossiers_tab', (req, res) => {
    const sql = `SELECT clients.client,dossiers.nom FROM clients,dossiers WHERE statut="en cours" and clients.id_client=dossiers.id_client`;
    db.query(sql, (err, results) => {
        if (err) throw err;
		res.render('dossiers_en_cours', { data: results });
	});
});

app.get('/getDES_tab', (req, res) => {
    const sql = `SELECT clients.client,factures.num_fact,DATE_FORMAT(factures.date_des_limite, '%d-%m-%Y') as date_limite  FROM clients,dossiers,factures WHERE des="à faire" and dossiers.id_dossier=factures.id_dossier and clients.id_client=dossiers.id_client and clients.id_client=dossiers.id_client`;
    db.query(sql, (err, results) => {
        if (err) throw err;
		res.render('des', { data: results });
	});
});

app.get('/getRelances_tab', (req, res) => {
    const sql = `SELECT clients.client,factures.num_fact,DATE_FORMAT(factures.date_fact, '%d-%m-%Y') as date_f  FROM clients,dossiers,factures WHERE factures.num_fact is not NULL and factures.date_regl is NULL and dossiers.id_dossier=factures.id_dossier and clients.id_client=dossiers.id_client and clients.id_client=dossiers.id_client and factures.date_fact < DATE_SUB(CURDATE(), INTERVAL 90 DAY)`;
    db.query(sql, (err, results) => {
        if (err) throw err;
		res.render('relances', { data: results });
	});
});


//------------------GESTION DE LA PAGE TIMESHEET--------------------------------------------------

app.post('/submit_timestamp', (req, res) => {
	const { action, id_dossier} = req.body;
	
	if(action === 'start') {
		if(session_ouverte==='yes') { 
			res.json({message:`Une session est actuellement en cours pour le dossier id:` + dossier_courant + ` : vous devez terminer cette session avant d'en entamer une autre.`});
		}
		const query_start = `INSERT INTO time_sheet (id_cpte,time_start,id_dossier) VALUES (?,NOW(),?)`;
		db.query(query_start, [id_user, id_dossier], (err, result) => {
			if (err) throw err;
			session_ouverte='yes';
			dossier_courant=id_dossier;
		});
	} else if(action === 'stop') {
		if(session_ouverte==='no') { 
			res.json({message:`Aucune session actuellement en cours : vous devez ouvrir une session avant de vouloir la fermer. Non mais ALLO !, quoi.`});
		}
		const query_stop = `update time_sheet set time_stop=NOW() where id_dossier=? and id_cpte=? and time_stop is NULL`;
		db.query(query_stop,[id_dossier,id_user], (err, result) => {
			if (err) throw err;
			session_ouverte='no';
			dossier_courant='';	
		});
		const query_diff = `update time_sheet SET duree = TIMEDIFF(time_stop, time_start) where id_dossier=? and id_cpte=? and duree is NULL`;
		db.query(query_diff, [id_dossier,id_user],(err, result) => {
			if (err) throw err;
		});
	}
});

// Route pour récupérer les options de la liste déroulante
app.get('/getDossiers', (req, res) => {
    const sql = `SELECT id_dossier,nom FROM dossiers WHERE statut="en cours"`;
    db.query(sql, (err, results) => {
        if (err) throw err;
       let options = '<select>';
        results.forEach(row => {
            options += `<option value="${row.id_dossier}">${row.nom}</option>`;
        });
        options += '</select>';
		console.log("options=",options);
        res.send(options);
    });
});

app.get('/getUsers', (req, res) => {
    const sql = `SELECT id,login FROM comptes`;
    var options='';
	
	db.query(sql, (err, results) => {
        if (err) throw err;
        options = '<select aria-labelledby="dropdown-container_users"><option>Tous</option>';
        results.forEach(row => {
            options += `<option value="${row.id}">${row.login}</option>`;
        });
        options += '</select>';
        res.send(options);
    });
});

app.get('/api/checkCondition', (req, res) => {
	if(dossier_courant==="") {
		isConditionMet=true;
	} else {
		isConditionMet=false;
	}
	res.json({ conditionMet: isConditionMet });
});

app.post('/getTime', (req, res) => {
    let id_user = req.body.id_user;
	let id_dossier = req.body.id_dossier;
	var sql ='';
	//console.log("id_user=",id_user," + id_dossier=",id_dossier);
	if(id_user==='Tous') {
		sql = `SELECT comptes.trigram,DATE_FORMAT(time_sheet.time_start, '%d-%m-%Y') as jour,time_sheet.duree FROM comptes,dossiers,time_sheet where dossiers.id_dossier=time_sheet.id_dossier and time_sheet.id_cpte=comptes.id and time_sheet.id_dossier='${id_dossier}'`;
    } else {
		sql = `SELECT comptes.trigram,DATE_FORMAT(time_sheet.time_start, '%d-%m-%Y') as jour,time_sheet.duree FROM comptes,dossiers,time_sheet where dossiers.id_dossier=time_sheet.id_dossier and time_sheet.id_cpte=comptes.id and time_sheet.id_dossier='${id_dossier}' and time_sheet.id_cpte='${id_user}' ORDER BY jour`;
	}
	//console.log("sql=",sql);
	db.query(sql, (err, results) => {
        if (err) throw err;
        res.render('detail_tps', { data: results });
    });
});

app.post('/getTotalTime', (req, res) => {
    let id_user = req.body.id_user;
	let id_dossier = req.body.id_dossier;
	var sql ='';
	//console.log("id_user=",id_user," + id_dossier=",id_dossier);
	if(id_user==='Tous') {
		
		sql = `SELECT comptes.trigram,SEC_TO_TIME(CEIL(SUM(TIME_TO_SEC(time_sheet.duree)) / 1800) * 1800) AS duree_totale_arrondie,comptes.tx_horaire,(comptes.tx_horaire * CEIL(SUM(TIME_TO_SEC(time_sheet.duree)) / 1800) * 1800 / 3600) AS montant_total FROM comptes,dossiers,time_sheet where dossiers.id_dossier=time_sheet.id_dossier and time_sheet.id_cpte=comptes.id and time_sheet.id_dossier='${id_dossier}' GROUP BY comptes.trigram, comptes.tx_horaire`;
		//sql = `SELECT comptes.trigram,SEC_TO_TIME(SUM(TIME_TO_SEC(time_sheet.duree))) AS duree_totale,comptes.tx_horaire FROM comptes,dossiers,time_sheet where dossiers.id_dossier=time_sheet.id_dossier and time_sheet.id_cpte=comptes.id and time_sheet.id_dossier='${id_dossier}' GROUP BY comptes.trigram, comptes.tx_horaire`;
    } else {
		sql = `SELECT comptes.trigram,SEC_TO_TIME(CEIL(SUM(TIME_TO_SEC(time_sheet.duree)) / 1800) * 1800) AS duree_totale_arrondie,comptes.tx_horaire,(comptes.tx_horaire * CEIL(SUM(TIME_TO_SEC(time_sheet.duree)) / 1800) * 1800 / 3600) AS montant_total FROM comptes,dossiers,time_sheet where dossiers.id_dossier=time_sheet.id_dossier and time_sheet.id_cpte=comptes.id and time_sheet.id_dossier='${id_dossier}' and time_sheet.id_cpte='${id_user}'`;
		//sql = `SELECT comptes.trigram,SEC_TO_TIME(SUM(TIME_TO_SEC(time_sheet.duree))) AS duree_totale,comptes.tx_horaire FROM comptes,dossiers,time_sheet where dossiers.id_dossier=time_sheet.id_dossier and time_sheet.id_cpte=comptes.id and time_sheet.id_dossier='${id_dossier}' and time_sheet.id_cpte='${id_user}'`;
	}

	db.query(sql, (err, result) => {
        if (err) throw err;
		//console.log("id_user=",id_user," + id_dossier=",id_dossier," + result=",result);
        res.render('total_tps', { data: result });
    });
});


//------------------GESTION DE LA PAGE DOSSIER_CREER---------------------------------------------------

app.get('/getClients', (req, res) => {
    const sql = `SELECT id_client,client FROM clients`;
    var options='';
	
	db.query(sql, (err, results) => {
        if (err) throw err;
        options = '<select aria-labelledby="dropdown-container_clients">';
        results.forEach(row => {
            options += `<option value="${row.id_client}">${row.client}</option>`;
        });
        options += '</select>';

        res.send(options);
    });
});

// Route pour récupérer les options de la liste déroulante
app.post('/getDossiers_client', (req, res) => {
    let id_client = req.body.id_client;
	let sql = `SELECT id_dossier,nom FROM dossiers WHERE statut="en cours" and id_client=?`;
	db.query(sql,[id_client], (err, results) => {
        if (err) throw err;
       let options = '<select aria-labelledby="dropdown-container_dossiers" size="5">';
        results.forEach(row => {
            options += `<option value="${row.id_dossier}">${row.nom}</option>`;
        });
        options += '</select>';

        res.send(options);
    });
});

app.post('/dossier_creer', (req, res) => {
    let dossier = req.body.dossier;
    let id_client = req.body.id_client;
	//console.log("req.body=",req.body);
	//console.log("JS dossier=",dossier," + id_client=",id_client);
    // Insérer les données dans la base de données
    let sql = `INSERT INTO dossiers (id_client,client,nom) VALUES (?,(SELECT client FROM clients WHERE id_client=?),?)`;
    db.query(sql,[id_client,id_client,dossier], (err, result) => {
        if (err) throw err;
		res.json({message:`Nouveau dossier créé avec succès.`});
    });
});

//------------------GESTION DE LA PAGE DOSSIER_EDIT---------------------------------------------------

app.post('/dossier_edit', (req, res) => {
    let id_dossier = req.body.id_dossier;
    //Lire les données dans la base de données
    let sql = `SELECT * FROM dossiers WHERE id_dossier=?`;
    //console.log("sql=",sql);
	db.query(sql,[id_dossier], (err, result) => {
        if (err) throw err;
		
		new_date_ps=moment(result[0].date_ps).format('YYYY-MM-DD');
		new_date_ok=moment(result[0].date_ok).format('YYYY-MM-DD');
		new_date_livrable=moment(result[0].date_livrable).format('YYYY-MM-DD');
		result[0].new_date_ps = new_date_ps;
		result[0].new_date_ok = new_date_ok;
		result[0].new_date_livrable = new_date_livrable;
		
		//console.log("result=",result);
		res.json(result[0]); // Envoie le résultat de la requête SQL au client
    });
});

app.post('/dossier_save', (req, res) => {
    let id_dossier = req.body.id_dossier;
    let nom = req.body.nom;
	let detail_ps = req.body.detail_ps;
	let date_ps = req.body.date_ps;
	let date_ok = req.body.date_ok;
	let date_livrable=req.body.date_livrable;
	let chemin_ps=req.body.chemin_ps;
	let chemin_livrable=req.body.chemin_livrable;
	let montant_ht=req.body.montant_ht;
	let comment=req.body.comment;

	//Ecrire les données dans la base de données
    let sql=''
	if(date_ps==='' && date_ok==='' && date_livrable==='') {
		//console.log("je passe ici 1");
		sql = `UPDATE dossiers SET comment=?,montant_ht=?,nom=?,detail_ps=?,propal_service=?,livrable=? WHERE id_dossier=?`;
		db.query(sql,[comment,montant_ht,nom, detail_ps,chemin_ps,chemin_livrable,id_dossier],(err, result, fields) => {
			if (err) throw err;
			//console.log("result=",result);
			res.json({message:`Dossier enregistré avec succès.`});
		});
	} else if(date_ps==='' && date_ok==='') {
		//console.log("je passe ici 2");
		sql = `UPDATE dossiers SET comment=?,montant_ht=?,nom=?,detail_ps=?,propal_service=?,livrable=?,date_livrable=? WHERE id_dossier=?`;
		db.query(sql,[comment,montant_ht,nom, detail_ps,chemin_ps,chemin_livrable,date_livrable,id_dossier],(err, result, fields) => {
			if (err) throw err;
			//console.log("result=",result);
			res.json({message:`Dossier enregistré avec succès.`});
		});
	} else if(date_ps==='' && date_livrable==='') {
		//console.log("je passe ici 3");
		sql = `UPDATE dossiers SET comment=?,montant_ht=?,nom=?,detail_ps=?,propal_service=?,livrable=?,date_ok=? WHERE id_dossier=?`;
		db.query(sql,[comment,montant_ht,nom,detail_ps,chemin_ps,chemin_livrable,date_ok,id_dossier],(err, result, fields) => {
			if (err) throw err;
			//console.log("result=",result);
			res.json({message:`Dossier enregistré avec succès.`});
		});
	} else if(date_ps==='') {
		//console.log("je passe ici 4");
		sql = `UPDATE dossiers SET comment=?,montant_ht=?,nom=?,detail_ps=?,propal_service=?,livrable=?,date_ok=?,date_livrable=? WHERE id_dossier=?`;
		db.query(sql,[comment,montant_ht,nom,detail_ps,chemin_ps,chemin_livrable,date_ok,date_livrable,id_dossier],(err, result, fields) => {
			if (err) throw err;
			//console.log("result=",result);
			res.json({message:`Dossier enregistré avec succès.`});
		});
	} else if(date_ok==='' && date_livrable==='') {
		//console.log("je passe ici 5");
		sql = `UPDATE dossiers SET comment=?,montant_ht=?,nom=?,detail_ps=?,propal_service=?,livrable=?,date_ps=? WHERE id_dossier=?`;
		db.query(sql,[comment,montant_ht,nom, detail_ps,chemin_ps,chemin_livrable,date_ps,id_dossier],(err, result, fields) => {
			if (err) throw err;
			//console.log("result=",result);
			res.json({message:`Dossier enregistré avec succès.`});
		});
	} else if(date_ok==='') {
		//console.log("je passe ici 6");
		sql = `UPDATE dossiers SET comment=?,montant_ht=?,nom=?,detail_ps=?,propal_service=?,livrable=?,date_ps=?,date_livrable=? WHERE id_dossier=?`;
		db.query(sql,[comment,montant_ht,nom, detail_ps,chemin_ps,chemin_livrable,date_ps,date_livrable,id_dossier],(err, result, fields) => {
			if (err) throw err;
			//console.log("result=",result);
			res.json({message:`Dossier enregistré avec succès.`});
		});
	} else if(date_livrable==='') {
		//console.log("je passe ici 7");
		sql = `UPDATE dossiers SET comment=?,montant_ht=?,nom=?,detail_ps=?,propal_service=?,livrable=?,date_ps=?,date_ok=? WHERE id_dossier=?`;
		db.query(sql,[comment,montant_ht,nom, detail_ps,chemin_ps,chemin_livrable,date_ps,date_ok,id_dossier],(err, result, fields) => {
			if (err) throw err;
			//console.log("result=",result);
			res.json({message:`Dossier enregistré avec succès.`});
		});
	} else {
		//console.log("je passe ici 8");
		sql = `UPDATE dossiers SET comment=?,montant_ht=?,nom=?,detail_ps=?,propal_service=?,livrable=?,date_ps=?,date_ok=?,date_livrable=? WHERE id_dossier=?`;
		db.query(sql,[comment,montant_ht,nom, detail_ps,chemin_ps,chemin_livrable,date_ps,date_ok,date_livrable,id_dossier],(err, result, fields) => {
			if (err) throw err;
			//console.log("result=",result);
			res.json({message:`Dossier enregistré avec succès.`});
		});
	}
	});

//------------------GESTION DE LA PAGE CLIENT_CREATE---------------------------------------------------

app.post('/client_creer', (req, res) => {
	let siret=req.body.siret;
	let siren=req.body.siren;
	let client_nom=req.body.client_nom;
	let forme_sociale=req.body.forme_sociale;
	let num_tva=req.body.num_tva;
	let contact=req.body.contact;
	let titre=req.body.titre;
	let c_adr1=req.body.c_adr1;
	let c_adr2=req.body.c_adr2;
	let c_adr3=req.body.c_adr3;
	let c_cp=req.body.c_cp;
	let c_ville=req.body.c_ville;
	let f_adr1=req.body.f_adr1;
	let f_adr2=req.body.f_adr2;
	let f_adr3=req.body.f_adr3;
	let f_cp=req.body.f_cp;
	let f_ville=req.body.f_ville;
	let pays=req.body.pays;
	let ue_oui=req.body.ue_oui;
	let ue_non=req.body.ue_non;
	let ue_na=req.body.ue_na;
	
	let adresse=c_adr1+"\n"+c_adr2+"\n"+c_adr3+"\n"+c_cp+"\n"+c_ville;
	let f_adresse=f_adr1+"\n"+f_adr2+"\n"+f_adr3+"\n"+f_cp+"\n"+f_ville;
	if (ue_na) {
		ue='n/a';
	} else if(ue_oui) {
		ue="oui";
	} else if (ue_non) {
		ue="non";
	}
//Ecrire les données dans la base de données
    let sql=`INSERT INTO clients (client,forme_sociale,siret,siren,tva_ue,contact,titre,adresse,pays,ue,adresse_facturation) VALUES (?,?,?,?,?,?,?,?,?,?,?)`;
	db.query(sql,[client_nom,forme_sociale,siret,siren,num_tva,contact,titre,adresse,pays,ue,f_adresse],(err, result, fields) => {
		if (err) throw err;
		//console.log("result=",result);
		res.json({message:`Client ajouté avec succès.`});
	});
});

//------------------GESTION DE LA PAGE CLIENT_EDIT---------------------------------------------------

app.post('/client_editer', (req, res) => {
    let id_client = req.body.id_client;
    //Lire les données dans la base de données
    let sql = `SELECT * FROM clients WHERE id_client='${id_client}'`;
    //console.log("sql=",sql);
	db.query(sql, (err, result) => {
        if (err) throw err;
		//console.log("result=",result);
		const ue=result[0].ue;
		// décomposition des adresses
		
		let c_adr=result[0].adresse.split('\n'); // Diviser le texte en un tableau de lignes
		// Extraire chaque ligne dans une variable distincte
		const c_adr1 = c_adr[0] || '';
		const c_adr2 = c_adr[1] || '';
		const c_adr3 = c_adr[2] || '';
		const c_cp = c_adr[3] || '';
		const c_ville= c_adr[4] || '';

		let f_adr=result[0].adresse_facturation.split('\n'); // Diviser le texte en un tableau de lignes
		// Extraire chaque ligne dans une variable distincte
		const f_adr1 = f_adr[0] || '';
		const f_adr2 = f_adr[1] || '';
		const f_adr3 = f_adr[2] || '';
		const f_cp = f_adr[3] || '';
		const f_ville= f_adr[4] || '';
		
		var ue_na="false";
		var ue_oui="false";
		var ue_non="false";
		
	if (ue==='n/a') {
		ue_na='true';
	} else if(ue==='oui') {
		ue_oui='true';
	} else if (ue==='non') {
		ue_non='true';
	}
		result[0].f_adr1 =f_adr1;
		result[0].f_adr2 =f_adr2;
		result[0].f_adr3 =f_adr3;
		result[0].f_cp =f_cp;
		result[0].f_ville=f_ville;
		result[0].c_adr1=c_adr1;
		result[0].c_adr2 =c_adr2;
		result[0].c_adr3 =c_adr3;
		result[0].c_cp =c_cp;
		result[0].c_ville=c_ville;
		result[0].ue_na=ue_na;
		result[0].ue_oui=ue_oui;
		result[0].ue_non=ue_non;
		
		res.json(result[0]); // Envoie le résultat de la requête SQL au client
    });
});
app.post('/client_update', (req, res) => {
	let id_client=req.body.id_client;
	let siret=req.body.siret;
	let siren=req.body.siren;
	let client=req.body.client;
	let forme_sociale=req.body.forme_sociale;
	let num_tva=req.body.num_tva;
	let contact=req.body.contact;
	let titre=req.body.titre;
	let c_adr1=req.body.c_adr1;
	let c_adr2=req.body.c_adr2;
	let c_adr3=req.body.c_adr3;
	let c_cp=req.body.c_cp;
	let c_ville=req.body.c_ville;
	let f_adr1=req.body.f_adr1;
	let f_adr2=req.body.f_adr2;
	let f_adr3=req.body.f_adr3;
	let f_cp=req.body.f_cp;
	let f_ville=req.body.f_ville;
	let pays=req.body.pays;
	let ue_oui=req.body.ue_oui;
	let ue_non=req.body.ue_non;
	let ue_na=req.body.ue_na;
	
	let adresse=c_adr1+"\n"+c_adr2+"\n"+c_adr3+"\n"+c_cp+"\n"+c_ville;
	let f_adresse=f_adr1+"\n"+f_adr2+"\n"+f_adr3+"\n"+f_cp+"\n"+f_ville;
	if (ue_na) {
		ue='n/a';
	} else if(ue_oui) {
		ue="oui";
	} else if (ue_non) {
		ue="non";
	}
//Ecrire les données dans la base de données
    let sql=`UPDATE clients SET forme_sociale=?,siret=?,siren=?,tva_ue=?,contact=?,titre=?,adresse=?,pays=?,ue=?,adresse_facturation=? WHERE id_client=?`;
	db.query(sql,[forme_sociale,siret,siren,num_tva,contact,titre,adresse,pays,ue,f_adresse,id_client],(err, result, fields) => {
		if (err) throw err;
		console.log("result=",result);
		res.json({message:`Client mis à jour avec succès.`});
	});
});

//------------------GESTION DE LA PAGE FACTURES---------------------------------------------------

app.post('/prepa_fact', (req, res) => {
    let id_dossier = req.body.id_dossier;
    //Lire les données dans la base de données
    let sql = `SELECT comment,id_dossier,montant_ht,detail_ps,(SELECT ue from clients,dossiers WHERE dossiers.id_dossier=? AND dossiers.id_client=clients.id_client) AS ue,(SELECT pays from clients,dossiers WHERE dossiers.id_dossier=? AND dossiers.id_client=clients.id_client) AS pays FROM dossiers WHERE id_dossier=?`;
    //console.log("sql=",sql);
	db.query(sql,[id_dossier,id_dossier,id_dossier], (err, result) => {
        if (err) throw err;
		//console.log("result=",result);
		res.json(result[0]); // Envoie le résultat de la requête SQL au client
    });
});

app.post('/facture_create', (req, res) => {
    let id_dossier = req.body.id_dossier;
	let num_fact = req.body.num_fact;
	let tva = req.body.tva;
	let date_fact = req.body.date_fact;
	let annee_fact = req.body.annee_fact;
	let ref_fact = req.body.ref_fact;
	let montant_ttc = req.body.montant_ttc;
	let des = req.body.des;
	let date_des_limite = req.body.date_des_limite;
	
    //Lire les données dans la base de données
    if(date_des_limite==='') {
		var sql = `INSERT INTO factures (id_dossier,num_fact,tva,date_fact,annee_fact,ref_fact,montant_ttc,des) VALUES (?,?,?,?,?,?,?,?)`;
		db.query(sql,[id_dossier,num_fact,tva,date_fact,annee_fact,ref_fact,montant_ttc,des], (err, result,fields) => {
			if (err) throw err;
			res.json({message:`Facture ${num_fact} initialisée avec succès`});
		});
	}else {
		var sql = `INSERT INTO factures (id_dossier,num_fact,tva,date_fact,annee_fact,ref_fact,montant_ttc,des,date_des_limite) VALUES (?,?,?,?,?,?,?,?,?)`;
		db.query(sql,[id_dossier,num_fact,tva,date_fact,annee_fact,ref_fact,montant_ttc,des,date_des_limite], (err, result,fields) => {
			if (err) throw err;
			res.json({message:`Facture ${num_fact} initialisée avec succès`});
		});
	}
});

app.get('/get_max_num_fact', (req, res) => {
	let sql=`SELECT MAX(num_fact) AS max_num_fact FROM factures`;
	db.query(sql, (err, result) => {
        if (err) throw err;
		res.json(result[0]); // Envoie le résultat de la requête SQL au client
    });
});

app.post('/update_detail_ps', (req, res) => {
    let id_dossier = req.body.id_dossier;
	let detail_ps=req.body.detail_ps;
	let comment=req.body.comment;
	
    //Mettre à jour les données dans la base de données
    let sql=`UPDATE dossiers SET detail_ps=?,comment=? WHERE id_dossier=?`;
	 //console.log("sql=",sql);
	db.query(sql,[detail_ps,comment,id_dossier], (err, result) => {
        if (err) throw err;		
		//console.log("result=",result);
		res.json({message:`Dossier mis à jour avec succès.`});
    });
});

app.post('/create_print_view', (req, res) => {
    let num_fact = req.body.num_fact;
	let id_dossier=req.body.id_dossier;

	// Requête SQL pour supprimer la vue existante
	const dropViewSql = `DROP VIEW IF EXISTS facture_a_imprimer`;
	db.query(dropViewSql, (err, result) => {
        if (err) throw err;
	});

	// Requête SQL pour créer la vue
	const createViewSql = `
		CREATE VIEW facture_a_imprimer AS
		SELECT num_fact,ref_fact,date_fact,montant_ht,tva,montant_ttc,detail_ps,clients.client,adresse_facturation,pays,siren,ue,tva_ue,contact,titre
		FROM factures,dossiers,clients
		WHERE num_fact=? and dossiers.id_dossier=? and clients.id_client=dossiers.id_client
	`	
	 //console.log("sql=",sql);
	db.query(createViewSql,[num_fact,id_dossier], (err, result) => {
        if (err) throw err;
		
		//console.log("result=",result);

		res.json(result[0]); // Envoie le résultat de la requête SQL au client
    });
	
	// Commande pour ouvrir le document avec l'application Microsoft Word
	const command = `start winword "02 - Sophie DORIN Creation Factures WEB.docx"`;

	// Exécution de la commande
	exec(command, (err, stdout, stderr) => {
		if (err) {
			console.error(`Erreur lors de l'ouverture du document : ${err}`);
			return;
		}
	});
	
});



