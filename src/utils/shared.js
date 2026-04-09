/**
 * @fileoverview Shared Common and Miscellaneous Utils
 * @module utils/common
 * @description Common and Miscellaneous Utils.
 */

/**
 * Generates and returns the current timestamp as a formatted string in the America/Los_Angeles timezone.
 */

function _getTimestampPstString_(){
  return Utilities.formatDate(
    new Date(), 
    'PST', 
    'yyyy-MM-dd\'T\'HH:mm:ss\'Z\''
  );
}
