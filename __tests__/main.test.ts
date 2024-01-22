/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * These should be run as if the action was called from a workflow.
 * Specifically, the inputs listed in `action.yml` should be set as environment
 * variables following the pattern `INPUT_<INPUT_NAME>`.
 */
import * as core from '@actions/core'
import * as google from '@googleapis/drive'
import { randomBytes, randomInt, randomUUID } from 'crypto'
import * as main from '../src/main'

// Default mocks declaration to dynamically retrieve generic types
let runMock = jest.spyOn(main, 'run')
let uploadFileMock = jest.spyOn(main, 'uploadFile')
let initDriveAPIMock = jest.spyOn(main, 'initDriveAPI')
let driveMock = jest.spyOn(google, 'drive')
let getInputMock = jest.spyOn(core, 'getInput')
let getBooleanInputMock = jest.spyOn(core, 'getBooleanInput')
let setOutputMock = jest.spyOn(core, 'setOutput')
let setFailedMock = jest.spyOn(core, 'setFailed')

describe('main', () => {
  beforeEach(() => {
    jest.restoreAllMocks()

    // Spy on main functions
    runMock = jest.spyOn(main, 'run')
    uploadFileMock = jest.spyOn(main, 'uploadFile')
    initDriveAPIMock = jest.spyOn(main, 'initDriveAPI')

    // Spy on google functions
    driveMock = jest.spyOn(google, 'drive')

    // Mock implementation of github core functions
    getInputMock = jest.spyOn(core, 'getInput').mockImplementation()
    getBooleanInputMock = jest.spyOn(core, 'getBooleanInput').mockImplementation()
    setOutputMock = jest.spyOn(core, 'setOutput').mockImplementation()
    setFailedMock = jest.spyOn(core, 'setFailed').mockImplementation()
  })

  it('should run without error', async () => {
    // given
    getInputMock.mockImplementation((name: string) => {
      switch (name) {
        case main.INPUT_CREDENTIALS:
          return 'credentialsMock'
        case main.INPUT_PARENT_FOLDER_ID:
          return 'parentFolderIdMock'
        case main.INPUT_SOURCE_FILEPATH:
          return 'sourceFilePathMock'
        case main.INPUT_TARGET_FILEPATH:
          return 'targetFilePathMock'
        default:
          return ''
      }
    })

    const inputOverwrite = Boolean(randomInt(2))
    getBooleanInputMock.mockReturnValue(inputOverwrite)

    const driveStub = new google.drive_v3.Drive({})
    initDriveAPIMock.mockReturnValue(driveStub)

    const outputFileId = randomBytes(15).toString('hex')
    uploadFileMock.mockReturnValue(Promise.resolve(outputFileId))

    // when
    await main.run()

    // then
    expect(runMock).toHaveReturned()
    expect(initDriveAPIMock).toHaveBeenCalledWith('credentialsMock')
    expect(uploadFileMock).toHaveBeenCalledWith(
      driveStub,
      'parentFolderIdMock',
      'sourceFilePathMock',
      'targetFilePathMock',
      inputOverwrite
    )
    expect(setOutputMock).toHaveBeenCalledWith(main.OUTPUT_FILE_ID, outputFileId)
    expect(setFailedMock).not.toHaveBeenCalled()
  })

  it('should fail with error', async () => {
    // given
    const incorrectCredentials = randomUUID()
    getInputMock.mockImplementation((name: string) => {
      if (name === main.INPUT_CREDENTIALS) {
        return incorrectCredentials
      } else {
        return ''
      }
    })

    // when
    await main.run()

    // then
    expect(runMock).toHaveReturned()
    expect(initDriveAPIMock).toHaveBeenCalledWith(incorrectCredentials)
    expect(setFailedMock).toHaveBeenCalledWith(expect.stringMatching('Unexpected token.*is not valid JSON'))
  })

  it('should initialize drive API with credentials valid format', async () => {
    // given
    const credentials = Buffer.from(
      `{
        "type": "service_account",
        "project_id": "project-id",
        "private_key_id": "${randomBytes(20).toString('hex')}",
        "private_key": "-----BEGIN PRIVATE KEY-----\\n${randomBytes(512).toString('hex')}\\n-----END PRIVATE KEY-----",
        "client_email": "foo.bar@project-id.iam.gserviceaccount.com",
        "client_id": "${randomBytes(10).toString('hex')}",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/foo.bar%40project-id.iam.gserviceaccount.com"
      }`
    ).toString('base64')

    // when
    const drive = main.initDriveAPI(credentials)

    // then
    expect(initDriveAPIMock).toHaveReturned()
    expect(driveMock).toHaveBeenCalled()
    expect(drive).toBeDefined()
    expect(drive.files).toBeDefined()
  })
})
