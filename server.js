const CronJob = require('cron').CronJob;
const mysql = require('mysql');
const request = require('request');
const fs = require('fs');
var devRant = require('rantscript');

const queries = JSON.parse(fs.readFileSync('queries.json', 'utf8'));
const config = JSON.parse(fs.readFileSync((fs.existsSync('config.json') ? 'config.json' : 'config.default.json'), 'utf8'));

const db = mysql.createConnection(config);
db.connect();

function storeNewEventData(webhookKey, eventData) {
	db.query(queries.setEventData, [JSON.stringify(eventData), webhookKey], function (error, result, fields) {
		if (error) throw error;
	});
}

function executeWebhook(webhookData, webhookVars, webhookCallback) {
	for(let variable in webhookVars) {
		webhookData.url = webhookData.url.replace(new RegExp('\\{ *' + variable + ' *\\}', 'g'), webhookVars[variable]);
		webhookData.body = webhookData.body.replace(new RegExp('\\{ *' + variable + ' *\\}', 'g'), webhookVars[variable]);
	}

	let requestOptions = {
		url: webhookData.url,
		method: webhookData.method,
		headers: {
			'User-Agent': 'devRant-Webhooks'
		}
	};

	switch(webhookData.contentType) {
		case 'application/x-www-form-urlencoded':
			requestOptions.form = webhookData.body;
			break;

		case 'application/json':
			requestOptions.json = true;
			requestOptions.body = webhookData.body;
			break;

		case 'text/plain':
			requestOptions.headers['Content-type'] = 'text/plain';
			requestOptions.body = webhookData.body;
			break;
	}

	request(requestOptions, webhookCallback);
}

function newRant() {
	// Check for a new rant
	db.query(queries.getWebhooks, 'newRant', function (error, results, fields) {
		if (error) throw error;
		//console.log(results);
	});
}

function newCommentOnRant() {
	// Check for a new rant
	db.query(queries.getWebhooks, 'newCommentOnRant', function (error, results, fields) {
		let errors = [];

		if (error) errors.push(error);
		else {
			for (let row of results) {
				let eventData = JSON.parse(row.eventData);

				devRant
					.rant(eventData.rantID)
					.then((response) => {
						let newComments = [];

						for (let comment of response.comments) {
							if (comment.created_time > eventData.lastTime) {
								newComments.push(comment);
							}
						}

						console.log({ newComments });
						for (let comment of newComments) {
							if(eventData.byUser) {
								let users = eventData.byUser.split(',');

								let byUserWroteComment = false;
								for(let user of users) {
									if(user.trim() === comment.user_username) {
										byUserWroteComment = true;
									}
								}

								if(!byUserWroteComment) {
									// If user didn't write comment then skip it
									continue;
								}
							}

							if (!comment.user_dpp) {
								comment.user_dpp = 0;
							}

							executeWebhook(row, comment, function (error, response, body) {
								if (error) {
									errors.push(error);
								}
							});
						}

						if (response.comments.length > 0)
							eventData.lastTime = response.comments[response.comments.length - 1].created_time;

						storeNewEventData(row.webhookKey, eventData);
					});
			}
		}

		if (errors.length > 0) {
			//storeNewErrors(row.webhookKey, errors);
			console.error(errors);
		}
	});
}

function newWeeklyRantTopic() {
	// Check for a new rant
	db.query(queries.getWebhooks, 'newWeeklyRantTopic', function (error, results, fields) {
		if (error) throw error;
		//console.log(results);
	});
}

newCommentOnRant();

var cronjobs = [
	new CronJob(config.cronjobTimes.newRant, newRant, null, true, 'America/New_York'),

	new CronJob(config.cronjobTimes.newCommentOnRant, newCommentOnRant, null, true, 'America/New_York'),

	new CronJob(config.cronjobTimes.newWeeklyRantTopic, newWeeklyRantTopic, null, true, 'America/New_York')
];