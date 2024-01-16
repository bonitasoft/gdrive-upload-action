import * as core from '@actions/core'
import * as google from '@googleapis/drive'
import * as fs from 'fs'

// Google Authorization scopes
const SCOPES = ['https://www.googleapis.com/auth/drive.file']

// Init Google Drive API instance
const drive = initDriveAPI()

function initDriveAPI(): google.drive_v3.Drive {
  const credentials = core.getInput('credentials', { required: true })
  const credentialsJSON = JSON.parse(
    Buffer.from(credentials, 'base64').toString()
  )
  const auth = new google.auth.GoogleAuth({
    credentials: credentialsJSON,
    scopes: SCOPES
  })
  return google.drive({ version: 'v3', auth })
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    // Get inputs

    // Set outputs
    core.setOutput('TODO', 'TODO')
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed(JSON.stringify(error))
    }
  }
}

async function upload(): Promise<void> {
  // TODO
}

async function getFileId(
  parentId: string,
  fileName: string
): Promise<string | null> {
  core.debug(`Getting file with name '${fileName}' under folder '${parentId}'`)
  const requestParams: google.drive_v3.Params$Resource$Files$List = {
    q: `name='${fileName}' and '${parentId}' in parents and trashed=false`,
    fields: 'files(id)',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  }
  const response = await drive.files.list(requestParams)

  const files: google.drive_v3.Schema$File[] | undefined = response.data.files
  if (files === undefined || files.length === 0) {
    core.debug(`No entry match the file name '${fileName}'`)
    return null
  }
  if (files.length > 1) {
    throw new Error(`More than one entry match the file name '${fileName}'`)
  }
  return files[0].id || null
}

async function createFolder(
  parentId: string,
  folderName: string
): Promise<string | null> {
  core.debug(`Creating folder '${folderName}' under folder '${parentId}'`)
  const requestParams: google.drive_v3.Params$Resource$Files$Create = {
    requestBody: {
      parents: [parentId],
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder'
    },
    fields: 'id',
    supportsAllDrives: true
  }
  const response = await drive.files.create(requestParams)
  const folder: google.drive_v3.Schema$File = response.data
  core.debug(`Folder id: ${folder.id}`)
  return folder.id || null
}

async function createFile(
  parentId: string,
  fileName: string | null,
  filePath: string
): Promise<string | null> {
  core.debug(`Creating file '${fileName}' under folder '${parentId}'`)
  const requestParams: google.drive_v3.Params$Resource$Files$Create = {
    requestBody: {
      parents: [parentId],
      name: fileName
    },
    media: {
      body: fs.createReadStream(filePath)
    },
    fields: 'id',
    supportsAllDrives: true
  }
  const response = await drive.files.create(requestParams)
  const file: google.drive_v3.Schema$File = response.data
  core.debug(`File id: ${file.id}`)
  return file.id || null
}
