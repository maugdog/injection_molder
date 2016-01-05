var tools = require('./tools.js'); // Load misc tools
var config = require('./config');
var Thermostat = require('thermostat');
var util = require('util');
var validator = require('validator');
var clc = require('cli-color');
var readlineSync = require('readline-sync');

/***********************************************/
/************** INITIALIZATION *****************/
/***********************************************/

// Use -settings or -s to load a specified saved configuration
// Use -quiet or -q to run silently
var args = tools.processCLArgs({});

// Read any command line arguments and establish default options
var settings = null; /*tools.processCLArgs({
  mode: 'heat', // heat || cool.
  units: 'f', // f for Fahrenheit, c for Celsius, k for Kelvin.
  temp: 80, // Target temperature in specified units.
  time: -1, // If greater than -1, then specifies the length of time (in ms) to hold the target temp.
  tolerance: 2, // Allowable tolerance in degrees of specified units.
  frequency: 1000, // Frequency of temperature samples in milliseconds.
  buffer: 2000 // The number of milliseconds that the switch must remain OFF before it can be turned BACK on. Prevents rapid switching cycles that can damage electronics.
});*/

// Load any saved settings
var fs = require("fs");
try {
  fs.statSync('settings.json');
  var settingsFile = fs.readFileSync('settings.json');
} catch(error) {
  var settingsFile = null;
}

var savedSettings = {};

if(settingsFile) {
  savedSettings = JSON.parse(settingsFile);
}

var optionsList = Object.keys(savedSettings);
if(optionsList.length) {
  if(args.hasOwnProperty('settings') && savedSettings.hasOwnProperty(args.settings)) {
    settings = savedSettings[args.settings];
  }
  if(args.hasOwnProperty('s') && savedSettings.hasOwnProperty(args.s)) {
    settings = savedSettings[args.s];
  }
  if(!settings) {
    var newSettingsLabel = 'New settings...';
    optionsList.push(newSettingsLabel);
    var selectedFileIndex = readlineSync.keyInSelect(optionsList, 'Select a preset settings file, or make a new one: ', {cancel: false});
    if(selectedFileIndex != optionsList.length-1) {
      settings = savedSettings[optionsList[selectedFileIndex]];
    }
  }
}

// If we still have no settings, then prompt the user
if(!settings) {
  settings = {};

  var mode = readlineSync.question('Is the thermostat heating or cooling?  (h/c): ');
  if(validator.isIn(mode, ['h','c'])) {
    settings['mode'] = mode === 'h' ? 'heat' : "cool";
    settings['units'] = readlineSync.question('Units? (c/k/f): ');
    if(validator.isIn(settings['units'], ['c','k','f'])) {
      settings['temp'] = readlineSync.question(util.format('Target temperature? (°%s): ', settings.units));
      if(validator.isFloat(settings['temp'], {max: 1000})) {
        settings['temp'] = parseFloat(settings['temp']);
        settings['tolerance'] = readlineSync.question(util.format('How much tolerance from the target temp should be allowed? (between 0 and 50°%s) ', settings.units));
        if(validator.isFloat(settings['tolerance'], {min: 1, max: 50})) {
          settings['tolerance'] = parseFloat(settings['tolerance']);
          settings['frequency'] = readlineSync.question('How often should the temperature sensor be sampled? (specify 500 to 60000 milliseconds between samples) ');
          if(validator.isInt(settings['frequency'], {min: 500, max: 60000})) {
            settings['frequency'] = parseInt(settings['frequency'], 10);
            settings['buffer'] = readlineSync.question('How much time should be enforced between each switch event? (specify 500 to 15000 millisecond buffer between switch toggles) ');
            if(validator.isInt(settings['buffer'], {min: 500, max: 15000})) {
              settings['buffer'] = parseInt(settings['buffer'], 10);
              if(readlineSync.keyInYNStrict('Save these settings for later use? ')) {
                var settingsName = readlineSync.question('Specify a name for these settings: ');
                savedSettings[settingsName] = settings;
                fs.writeFileSync('settings.json', JSON.stringify(savedSettings));

                var ready = readlineSync.question('Press "Enter" to start...');
              }
            } else {
              console.error('Error! Buffer must be an integer between 500 and 15000.');
              process.exit(0);
            }
          } else {
            console.error('Error! Frequency must be an integer between 500 and 60000.');
            process.exit(0);
          }
        } else {
          console.error('Error! Tolerance must be a number between 0 and 50.');
          process.exit(0);
        }
      } else {
        console.error('Error! Target temp must be a number less than 1000.');
        process.exit(0);
      }
    } else {
      console.error('Error! Unrecognized units. Please use "c", "k", or "f".');
      process.exit(0);
    }
  } else {
    console.error('Error! Unrecognized mode. Please use "h", or "c".');
    process.exit(0);
  }
}

// Convert the command line args to the options required by the thermostat module
function thermostatOptions() {
  return {
    isHeater: settings.mode === 'heat',
    targetTemp: toCelsius(settings.units, settings.temp), // Need to send celsius units to thermostat
    holdTime: settings.time,
    tolerance: toCelciusDegrees(settings.units, settings.tolerance), // Need to send celsius units to thermostat
    frequency: settings.frequency,
    buffer: settings.buffer
  }
}

var thermostat = new Thermostat(thermostatOptions());
var powerSwitch = config.powerSwitch;
thermostat.powerSwitch = powerSwitch;
thermostat.thermoSensor = config.thermoSensor;
if(!args.hasOwnProperty('quiet') && !args.hasOwnProperty('q')) {
  thermostat.afterTempRead = function(sender) { outputStateToCLI(); };
}

thermostat.run();

/***********************************************/
/******** TEMPERATURE UNIT CONVERSIONS *********/
/***********************************************/

function toCelciusDegrees(fromUnits, value) {
  switch(fromUnits) {
    case 'f':
      return value * (5/9);
    default:
      return value;
  }
}

function toCelsius(fromUnits, value) {
  switch(fromUnits) {
    case 'k':
      return value - 273.15;
    case 'f':
      return (value - 32) / (9/5);
    case 'c':
    default:
      return value;
  }
}

function fromCelsius(toUnits, value) {
  switch(toUnits) {
    case 'k':
      return value + 273.15;
    case 'f':
      return (value * (9/5)) + 32;
    case 'c':
    default:
      return value;
  }
}

function toMAX31855UnitConstant(unitString) {
  switch(unitString) {
    case 'c':
      return max31855.UNITS.CELSIUS;
    case 'k':
      return max31855.UNITS.KELVIN;
    case 'f':
    default:
      return max31855.UNITS.FAHRENHEIT;
  }
}

/***********************************************/
/************* COMMAND LINE OUTPUT *************/
/***********************************************/

function timeRemainingLabel() {
  var timeRemaining = thermostat.timeRemaining();
  if(timeRemaining >= 0) {
    timeRemaining = Math.floor(timeRemaining/1000); // Thermostat returns remaining time in ms

    var hours   = Math.floor(timeRemaining / 3600);
    var minutes = Math.floor((timeRemaining - (hours * 3600)) / 60);
    var seconds = timeRemaining - (hours * 3600) - (minutes * 60);

    // Pad single digit nums
    if (hours   < 10) {hours   = '0' + hours;}
    if (minutes < 10) {minutes = '0' + minutes;}
    if (seconds < 10) {seconds = '0' + seconds;}

    return util.format('Remaining: %s:%s:%s\t\t', hours, minutes, seconds);
  }
  return '';
}

function outputStateToCLI() {
  process.stdout.write(clc.erase.screen);
  process.stdout.write(clc.move.to(0, 0));
  if(thermostat.isHeater) {
    var stateText = powerSwitch.isOn ? clc.xterm(202)('ON') : clc.green('OFF');
    var stateLabel = "Heater";
  } else {
    var stateText = powerSwitch.isOn ? clc.blue('● ON') : clc.green('○ OFF');
    var stateLabel = "Chiller";
  }

  var currentTemp = fromCelsius(settings.units, thermostat.currentTemp);
  if(currentTemp > settings.targetTemp + settings.tolerance) {
    currentTemp = clc.bold.red(currentTemp.toFixed(1));
  } else if(currentTemp < settings.targetTemp - settings.tolerance) {
    currentTemp = clc.bold.blue(currentTemp.toFixed(1));
  } else {
    currentTemp = clc.bold(currentTemp.toFixed(1));
  }
  var currentTemp = clc.bold(fromCelsius(settings.units, thermostat.currentTemp).toFixed(1));
  var setTemp = fromCelsius(settings.units, thermostat.targetTemp).toFixed(1);
  process.stdout.write(util.format('%sSet: %s°%s\t\tTemp(°%s): %s\t\t%s: %s\n\n', timeRemainingLabel(), setTemp, settings.units, settings.units, currentTemp, stateLabel, clc.bold(stateText)));
}

/***********************************************/
/*************** GRACEFUL EXIT *****************/
/***********************************************/

var exitHandler = function(options, err) {
  thermostat.stop();
  powerSwitch.destroy();

  if (options.cleanup) console.log('clean');
  if (err) console.log(err.stack);
  if (options.exit) process.exit();
};

process.on('exit', exitHandler.bind(null,{cleanup:true})); // Handle app close events
process.on('SIGINT', exitHandler.bind(null, {exit:true})); // Catches ctrl+c event
process.on('uncaughtException', exitHandler.bind(null, {exit:true})); // Catches uncaught exceptions
