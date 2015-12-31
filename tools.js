module.exports = {
  /** This function accepts an object of parameters and processes the command line arguments into that object.
   *
   * @param {Object} params A collection of default parameters.
   * @returns {Object} An object representing the params object updated with the command line arguements
   * used to run the current script, or a fresh object containing the CL objects if params is null.
   */
  processCLArgs: function(params) {
     // Process the command line parameters
     var currentArg = null;
     var nodeIndex = null;
     process.argv.forEach(function (val, index, array) {
       // The 'node' and script.js strings are included in the args, so we need to track/ignore them.
       nodeIndex = (nodeIndex === null && (val === 'node' || (val.length >= 5 && val.substr(val.length-5) === '/node')) ? index : nodeIndex);
       if(nodeIndex !== null && index >= nodeIndex+2) {
         // ignore the first two arguments
         // New argument
         if(val.charAt(0) === '-') {
           if(currentArg) { // Close out any pending arguments
             params[currentArg] = null;
           }
           currentArg = val.substring(1);
         } else if(currentArg) {
           params[currentArg] = val;
           currentArg = null; // Close out the current argument
         } else {
           console.error('Undesignated command line argument: ' + val);
         }
       }
     });

     // Close any trailing arguments that have no value
     if(currentArg) { // Close out any existing arguments
       params[currentArg] = null;
     }

     return params;
  }
};
