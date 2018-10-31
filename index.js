const {execFileSync} = require('child_process');
const {cyan, green, yellow} = require('chalk');
const {prompt} = require('inquirer');


console.log(cyan(`\n============================  iOS iPhone|iPad CLI Helper  ============================\n`));
console.log(green('Retrieve all iPhone|iPad simulators'));

const simulators = getAllSimulators();

console.log(green('All iPhone|iPad simulators retrieved'));

prompt([{
  type: 'list',
  name: 'simulator',
  message: 'On which simulator do you want to run your test?',
  choices: simulators,
},])
  .then((answer) => {
    const chosenSimulator = simulators.find(simulator => simulator.name === answer.simulator);

    closeBootedSimulator(chosenSimulator);
    bootSimulator(chosenSimulator);
    startSimulator(chosenSimulator);

    console.log(cyan(`\n============================  iOS iPhone|iPad CLI Helper  ============================\n`));
  });


/**
 * Get all the simulators that are hosted on the local machine
 *
 * @returns {
 *    {
 *      availability: string,
 *      name: string,
 *      state: string
 *      udid: string,
 *      version: string
 *    }[]
 *  }
 */
function getAllSimulators() {
  const simulators = [];
  const devices = JSON.parse(execFileSync('xcrun', ['simctl', 'list', '--json', 'devices'], {encoding: 'utf8'})).devices;

  Object.keys(devices)
    .filter(version => version.indexOf('iOS') === 0)
    .forEach(version => devices[version].map(simulator => simulators.push({
        ...simulator,
        availability: simulator.availability.match(/\((.*)\)/)[1],
        name: `${simulator.name} ${version.split(' ')[1]}`,
        version: version.split(' ')[1]
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
    console.log(yellow(`The ${chosenSimulator.name} is already opened. It will be closed.`));
    execFileSync('xcrun', ['simctl', 'shutdown', chosenSimulator.udid], {encoding: 'utf8'});
    console.log(green(`${chosenSimulator.name} has been shut down.`));
  }
}

/**
 * Boot a chosen simulator
 *
 * @param {object} chosenSimulator
 */
function bootSimulator(chosenSimulator) {
  execFileSync('xcrun', ['simctl', 'boot', chosenSimulator.udid], {encoding: 'utf8'});
  console.log(green(`${chosenSimulator.name} wil be booted.`));
}

/**
 * Start the Simulator app
 *
 * @param {object} chosenSimulator
 */
function startSimulator(chosenSimulator) {
    console.log(green(`${chosenSimulator.name} wil be opened.`));
    execFileSync('open', ['-a', 'Simulator.app'], {encoding: 'utf8'});
}
