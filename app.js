var tools = require('./tools.js'); // Load misc tools
var max31855 = require('max31855');
var Thermostat = require('thermostat');
//var ps = require('powerswitch'); // Will only work on a system with GPIO pins! Otherwise you'll get build errors
var util = require('util');
var validator = require('validator');
var clc = require('cli-color');
var readline_sync = require('readline-sync');

/***********************************************/
/************** INITIALIZATION *****************/
/***********************************************/

// Read any command line arguments and establish default options
var settings = tools.processCLArgs({
  mode: 'heat', // heat || cool.
  units: 'f', // f for Fahrenheit, c for Celsius, k for Kelvin.
  temp: 80, // Target temperature in specified units.
  time: -1, // If greater than -1, then specifies the length of time (in ms) to hold the target temp.
  tolerance: 2, // Allowable tolerance in degrees of specified units.
  frequency: 1000, // Frequency of temperature samples in milliseconds.
  buffer: 2000 // The number of milliseconds that the switch must remain OFF before it can be turned BACK on. Prevents rapid switching cycles that can damage electronics.
});

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
//var powerswitch = new ps(17);
var powerswitch = new DummySwitch();

thermostat.powerswitch = powerswitch;
//thermostat.thermoSensor = new max31855();
thermostat.thermoSensor = new DummySensor({thermostat: thermostat, powerswitch: powerswitch, start: 20, increment: 0.5, decrement: 0.2});
thermostat.afterTempRead = function(sender) { outputStateToCLI(); };

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
/******************* TESTING *******************/
/***********************************************/

// Dummy sensor for testing
function DummySensor(options) {
  this.thermostat = options.hasOwnProperty('thermostat') ? options.thermostat : null;
  this.powerswitch = options.hasOwnProperty('powerswitch') ? options.powerswitch : null;
  this.temp = options.start;
  this.increment = options.increment;
  this.decrement = options.decrement;

  /** Return a random integer! */

  this.readTemp = function(callback) {
    if(this.powerswitch.isOn) {
      this.temp += this.increment * (thermostat.isHeater ? 1 : -1);
    } else {
      this.temp -= this.decrement * (thermostat.isHeater ? 1 : -1);
    }

    if(callback) {
      callback(Number((this.temp).toFixed(2)));
    } else {
      console.log('Error: Read request issued with no callback.');
    }
  };
}

// Dummy switch for testing
function DummySwitch() {
  this.isOn = false;

  this.setOn = function() {
    this.isOn = true;
  };

  this.setOff = function() {
    this.isOn = false;
  };

  this.destroy = function() {
    // No op
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
    var stateText = powerswitch.isOn ? clc.xterm(202)('ON') : clc.green('OFF');
    var stateLabel = "Heater";
  } else {
    var stateText = powerswitch.isOn ? clc.blue('● ON') : clc.green('○ OFF');
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
/***** PROMPT USER FOR SETTING AND RUN IT ******/
/***********************************************/

var units = readline_sync.question('Units? (c/k/f): ');
if(validator.isIn(units, ['c','k','f'])) {
  settings.units = units;

  var target = readline_sync.question(util.format('Target temperature? (°%s): ', settings.units));
  if(validator.isFloat(target, {max: 1000})) {
    settings.temp = parseFloat(target);

    var ready = readline_sync.question('Press "Enter" to start...');
    thermostat.updateOptions(thermostatOptions());
    thermostat.run();
  } else {
    console.error('Error! Target temp must be a number less than 1000.');
  }
} else {
  console.error('Error! Unrecognized units. Please use "c", "k", or "f".');
}

var exitHandler = function(options, err) {
  thermostat.stop();
  powerswitch.destroy();

  if (options.cleanup) console.log('clean');
  if (err) console.log(err.stack);
  if (options.exit) process.exit();
};

process.on('exit', exitHandler.bind(null,{cleanup:true})); // Handle app close events
process.on('SIGINT', exitHandler.bind(null, {exit:true})); // Catches ctrl+c event
process.on('uncaughtException', exitHandler.bind(null, {exit:true})); // Catches uncaught exceptions
