const CronJob = require('cron').CronJob;
const mysql = require('mysql');
const request = require('request');
const fs = require('fs');
var devRant = require('rantscript');

const queries = JSON.parse(fs.readFileSync('queries.json', 'utf8'));
const config = JSON.parse(fs.readFileSync((fs.existsSync('config.json') ? 'config.json' : 'config.default.json'), 'utf8'));

const db = mysql.createConnection(config);
db.connect();

if(!config.consoleOutput)
	console.log = console.error = function() {};

function storeNewEventData(webhookKey, eventData) {
	db.query(queries.setEventData, [JSON.stringify(eventData), webhookKey], function (error, result, fields) {
		if (error) throw error;
	});
}

function executeWebhook(webhookData, webhookVars, webhookCallback) {
	for (let variable in webhookVars) {
		webhookData.url = webhookData.url.replace(new RegExp('\\{ *' + variable + ' *\\}', 'g'), webhookVars[variable]);
		webhookData.body = webhookData.body.replace(new RegExp('\\{ *' + variable + ' *\\}', 'g'), webhookVars[variable]);
	}

	let requestOptions = {
		url:     webhookData.url,
		method:  webhookData.method,
		headers: {
			'User-Agent': 'devRant-Webhooks'
		}
	};

	switch (webhookData.contentType) {
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
	console.log('\n> Cronjob "newCommentOnRant" fired.');

	console.log('> Fetching Webhooks with event-type "newCommentOnRant"...');
	db.query(queries.getWebhooks, 'newCommentOnRant', function (error, results, fields) {
		let errors = [];

		if (error) {
			errors.push(error);
			console.error('! An error occurred while fetching Webhooks: ' + error);
		} else {
			console.log('> Done.');

			for (let row of results) {
				console.log('\n> Checking Webhook with key "' + row.webhookKey + '"...');

				let eventData = JSON.parse(row.eventData);

				console.log('> Fetching Rant...');
				devRant
					.rant(eventData.rantID)
					.then((response) => {
						console.log('> Done.');
						let newComments = [];

						console.log('> Checking for new comments...');
						for (let comment of response.comments) {
							if (comment.created_time > eventData.lastTime) {
								newComments.push(comment);
							}
						}
						console.log('> Found ' + newComments.length + ' new comments.');

						for (let comment of newComments) {
							console.log('\n> Comment ' + comment.id);

							if (eventData.byUser) {
								console.log('> Checking if comment posted by specified user...');

								let users = eventData.byUser.split(',');

								let byUserWroteComment = false;
								for (let user of users) {
									if (user.trim() === comment.user_username) {
										byUserWroteComment = true;
									}
								}

								if (!byUserWroteComment) {
									console.log('> Specified user didn\'t post this comment. Skipping...');
									// If user didn't write comment then skip it
									continue;
								}

								console.log('> Comment was posted by specified user.');
							}

							if (!comment.user_dpp) {
								comment.user_dpp = 0;
							}

							console.log('> Executing Webhook...');
							executeWebhook(row, comment, function (error, response, body) {
								if (error) {
									errors.push(error);
									console.error('! Error while executing Webhook with key "' + row.webhookKey + '": ' + error);
								} else {
									console.log('> Webhook with key "' + row.webhookKey + '" successfully executed.');
								}
							});
						}

						console.log('> Updating Webhook data...');
						if (response.comments.length > 0) {
							eventData.lastTime = response.comments[response.comments.length - 1].created_time;
						}

						storeNewEventData(row.webhookKey, eventData);
						console.log('> Updated.');
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