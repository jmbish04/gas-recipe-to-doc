/**
 * @fileoverview Utils for streamling CONFIG objects
 * @module utils/logger
 * @description Utils for streamling CONFIG objects
 */

/**
 * Generates a SESSION folder for storing images, etc.
 * @param {string} session_id - The session uuid.
 */
function _createSessionFolder_(session_id){
  const scriptProps = PropertiesService.getScriptProperties();
  const sessionParentFolderId = scriptProps.getProperty('SESSION_PARENT_FOLDER_ID');
  const errors = [];
  if(!session_id) errors.push(`session_id param is null`);
  if(!sessionParentFolderId) errors.push(`sessionParentFolderId param is null`);

  if(errors.length>0){
    const errorMessage = `[_createSessionFolder_] there are ${errors.length} errors: ${errors.join('\n')}`;
    console.error(errorMessage);
    return {
      success: false,
      newSessionFolderId: null,
      newSessionFolderUrl: null,
      newSessionFolder: null,
      errorMessage, 
      errors
    };
  }

  try{
    const sessionParentFolder = DriveApp.getFolderById(sessionParentFolderId);
    const newSessionFolder = sessionParentFolder.createFolder(session_id);
  
    return {
      success: true,
      newSessionFolderId: newSessionFolder.getId(),
      newSessionFolderUrl: newSessionFolder.getUrl(),
      newSessionFolder,
      errorMessage: 'N/A', 
      errors
    };
  }
  catch(error){
    const errorMessage = `[_createSessionFolder_] DriveApp failure: ${error}`;
    console.error(errorMessage);
    return {
      success: false,
      newSessionFolderId: null,
      newSessionFolderUrl: null,
      newSessionFolder: null,
      errorMessage, 
      errors
    };
  }

}
  
