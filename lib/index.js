#!/usr/bin/env node
import { execFileSync } from 'child_process';
import { cyan, red, yellow, green } from 'chalk';
import { prompt } from 'inquirer';

const MESSAGE_TYPES = {
	ERROR: 'error',
	NOTIFY: 'notify',
	STEP: 'step',
	WARNING: 'warning',
};

(async () => {
	const simulators = getAllSimulators();
	const questions = [
		{
			type: 'list',
			name: 'simulator',
			message: 'On which simulator do you want to run your test?',
			choices: simulators,
		},
	];

	logMessage(
		MESSAGE_TYPES.NOTIFY,
		'iOS iPhone|iPad CLI Helper',
	);

	if (simulators.length > 0) {
		const answer = await prompt(questions);
		const chosenSimulator = simulators.find(simulator => simulator.name === answer.simulator);

		closeBootedSimulator(chosenSimulator);
		bootSimulator(chosenSimulator);
		startSimulator(chosenSimulator);

		logMessage(
			MESSAGE_TYPES.NOTIFY,
			'Thank you for using iOS iPhone|iPad CLI Helper',
		);

	} else {
		logMessage(
			MESSAGE_TYPES.ERROR,
			'NO ANDROID EMULATORS SPECIFIED',
		);
	}

})();


/**
 * Get all the simulators that are hosted on the local machine
 *
 * @returns {
 *    {
 *      name: string,
 *      state: string
 *      udid: string,
 *      version: string
 *    }[]
 *  }
 */
function getAllSimulators() {
	const simulators = [];
	const devices = JSON.parse(execFileSync('xcrun', [ 'simctl', 'list', '--json', 'devices' ], { encoding: 'utf8' })).devices;

	Object.keys(devices)
				.filter(version => version.includes('iOS'))
				.forEach(version => devices[ version ].map(simulator =>
					simulators.push({
						...simulator,
						name: `${ simulator.name } ${ version.split('-')[ 1 ] }.${ version.split('-')[ 2 ] }`,
						version: version.split(' ')[ 1 ]
					})
				));

	return simulators
}

/**
 * Shut down a booted simulator
 *
 * @param {object} chosenSimulator
 */
function closeBootedSimulator(chosenSimulator) {
	if (chosenSimulator.state === 'Booted') {
		stepMessage(MESSAGE_TYPES.WARNING, `The ${ chosenSimulator.name } is already opened. It will be closed.`);
		execFileSync('xcrun', [ 'simctl', 'shutdown', chosenSimulator.udid ], { encoding: 'utf8' });
		stepMessage(MESSAGE_TYPES.STEP, `${ chosenSimulator.name } has been shut down.`);
	}
}

/**
 * Boot a chosen simulator
 *
 * @param {object} chosenSimulator
 */
function bootSimulator(chosenSimulator) {
	execFileSync('xcrun', [ 'simctl', 'boot', chosenSimulator.udid ], { encoding: 'utf8' });
	stepMessage(MESSAGE_TYPES.STEP, `${ chosenSimulator.name } wil be booted.`);
}

/**
 * Start the Simulator app
 *
 * @param {object} chosenSimulator
 */
function startSimulator(chosenSimulator) {
	stepMessage(MESSAGE_TYPES.STEP, `${ chosenSimulator.name } wil be opened.`);
	execFileSync('open', [ '-a', 'Simulator.app' ], { encoding: 'utf8' });
}

/**
 * Print the message
 *
 * @param {string} type
 * @param {string} message
 */
function logMessage(type, message) {
	const messageType = type === MESSAGE_TYPES.NOTIFY ? cyan : red;
	console.log(messageType(`
====================================================================================================
  
  ${ message }
  
====================================================================================================
`));
}

/**
 * Print the step
 *
 * @param {string} type
 * @param {string} stepMessage
 */
function stepMessage(type, stepMessage) {
	const messageType = type === MESSAGE_TYPES.STEP ? green : yellow;

	console.log(messageType(`\n${ stepMessage }`));
}
