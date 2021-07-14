import { v4 as uuidv4 } from 'uuid';
import { apiPath, DEFAULT_ERROR_MESSAGES, ErrorCodes, GenericErrorTypes } from './constants';
import { IAnalysisResult } from './interfaces/analysis-result.interface';
import { IFileContent, IFiles, ISupportedFiles } from './interfaces/files.interface';
import { RequestOptions } from './interfaces/http-options.interface';
import { promises as dns } from 'dns';
import { IPv6, parse } from 'ipaddr.js';
import { URL } from 'url';
import { makeRequest, Payload } from './needle';

type ResultSuccess<T> = { type: 'success'; value: T };
type ResultError<E> = {
  type: 'error';
  error: {
    statusCode: E;
    statusText: string;
    apiName: string;
  };
};

export type IResult<T, E> = ResultSuccess<T> | ResultError<E>;

export function determineErrorCode(error: any): ErrorCodes {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { response }: { response: any | undefined } = error;
  if (response) {
    return response.status;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { errno, code }: { errno: string | undefined; code: string | number | undefined } = error;
  if (errno === 'ECONNREFUSED') {
    // set connectionRefused item
    return ErrorCodes.connectionRefused;
  }
  if (errno === 'ECONNRESET') {
    // set connectionRefused item
    return ErrorCodes.connectionRefused;
  }

  if (code === 'ENOTFOUND') {
    return ErrorCodes.dnsNotFound;
  }

  // We must be strict here and if none of our existing logic recognized this error, just throw it up.
  throw error;
}

// The trick to typecast union type alias
function isSubsetErrorCode<T>(code: any, messages: { [c: number]: string }): code is T {
  if (code in messages) {
    return true;
  }
  return false;
}

function generateError<E>(error: any, messages: { [c: number]: string }, apiName: string): ResultError<E> {
  const errorCode = determineErrorCode(error);

  if (!isSubsetErrorCode<E>(errorCode, messages)) {
    throw error;
  }

  const statusCode = errorCode;
  const statusText = messages[errorCode];

  return {
    type: 'error',
    error: {
      apiName,
      statusCode,
      statusText,
    },
  };
}

type StartSessionResponseDto = {
  readonly draftToken: string;
  readonly loginURL: string;
};

const GENERIC_ERROR_MESSAGES: { [P in GenericErrorTypes]: string } = {
  [ErrorCodes.serverError]: DEFAULT_ERROR_MESSAGES[ErrorCodes.serverError],
  [ErrorCodes.badGateway]: DEFAULT_ERROR_MESSAGES[ErrorCodes.badGateway],
  [ErrorCodes.serviceUnavailable]: DEFAULT_ERROR_MESSAGES[ErrorCodes.serviceUnavailable],
  [ErrorCodes.timeout]: DEFAULT_ERROR_MESSAGES[ErrorCodes.timeout],
  [ErrorCodes.dnsNotFound]: DEFAULT_ERROR_MESSAGES[ErrorCodes.dnsNotFound],
  [ErrorCodes.connectionRefused]: DEFAULT_ERROR_MESSAGES[ErrorCodes.connectionRefused],
};

export function startSession(options: { readonly authHost: string; readonly source: string }): StartSessionResponseDto {
  const { source, authHost } = options;
  const draftToken = uuidv4() as string;

  return {
    draftToken,
    loginURL: `${authHost}/login?token=${draftToken}&utm_medium=${source}&utm_source=${source}&utm_campaign=${source}&docker=false`,
  };
}

export type IpFamily = 6 | undefined;
/**
 * Dispatches a FORCED IPv6 request to test client's ISP and network capability.
 *
 * @return {number} IP family number used by the client.
 */
export async function getIpFamily(authHost: string): Promise<IpFamily> {
  const authHostUrl = new URL(authHost);
  const family = 6;
  try {
    const { address } = await dns.lookup(authHostUrl.hostname, {
      family,
    });

    const res = parse(address) as IPv6;
    return !res.isIPv4MappedAddress() ? family : undefined;
  } catch (e) {
    /* IPv6 is not enabled */
    return undefined;
  }
}

type CheckSessionErrorCodes = GenericErrorTypes | ErrorCodes.unauthorizedUser | ErrorCodes.loginInProgress;
const CHECK_SESSION_ERROR_MESSAGES: { [P in CheckSessionErrorCodes]: string } = {
  ...GENERIC_ERROR_MESSAGES,
  [ErrorCodes.unauthorizedUser]: DEFAULT_ERROR_MESSAGES[ErrorCodes.unauthorizedUser],
  [ErrorCodes.loginInProgress]: DEFAULT_ERROR_MESSAGES[ErrorCodes.loginInProgress],
};

interface IApiTokenResponse {
  ok: boolean;
  api: string;
}

export async function checkSession(options: {
  readonly authHost: string;
  readonly draftToken: string;
  readonly ipFamily?: IpFamily;
}): Promise<IResult<string, CheckSessionErrorCodes>> {
  const { draftToken, authHost, ipFamily } = options;

  try {
    const response = await makeRequest({
      url: `${authHost}/api/v1/verify/callback`,
      body: {
        token: draftToken,
      },
      family: ipFamily,
      method: 'post',
    });

    const responseBody = response.body as IApiTokenResponse;
    return {
      type: 'success',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      value: (response.res.statusCode === 200 && responseBody.ok && responseBody.api) || '',
    };
  } catch (err) {
    //todo
    if (
      [ErrorCodes.loginInProgress, ErrorCodes.unauthorizedContent, ErrorCodes.unauthorizedUser].includes(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        err.response?.status,
      )
    ) {
      return { type: 'success', value: '' };
    }

    return generateError<CheckSessionErrorCodes>(err, CHECK_SESSION_ERROR_MESSAGES, 'checkSession');
  }
}

export async function getFilters(
  baseURL: string,
  source: string,
): Promise<IResult<ISupportedFiles, GenericErrorTypes>> {
  const apiName = 'filters';

  try {
    const response = await makeRequest({
      headers: { source },
      url: `${baseURL}${apiPath}/${apiName}`,
      method: 'get',
    });

    const responseBody = response.body as ISupportedFiles;
    return { type: 'success', value: responseBody };
  } catch (error) {
    // todo
    return generateError<GenericErrorTypes>(error, GENERIC_ERROR_MESSAGES, apiName);
  }
}

export type RemoteBundle = {
  readonly bundleId: string;
  readonly missingFiles: string[];
  readonly uploadURL?: string;
};

export type CreateBundleErrorCodes =
  | GenericErrorTypes
  | ErrorCodes.unauthorizedUser
  | ErrorCodes.unauthorizedBundleAccess
  | ErrorCodes.bigPayload
  | ErrorCodes.unauthorizedContent
  | ErrorCodes.notFound;

const CREATE_BUNDLE_ERROR_MESSAGES: { [P in CreateBundleErrorCodes]: string } = {
  ...GENERIC_ERROR_MESSAGES,
  [ErrorCodes.unauthorizedUser]: DEFAULT_ERROR_MESSAGES[ErrorCodes.unauthorizedUser],
  [ErrorCodes.unauthorizedBundleAccess]: DEFAULT_ERROR_MESSAGES[ErrorCodes.unauthorizedBundleAccess],
  [ErrorCodes.bigPayload]: DEFAULT_ERROR_MESSAGES[ErrorCodes.bigPayload],
  [ErrorCodes.unauthorizedContent]: `Request content doesn't match the specifications`,
  [ErrorCodes.notFound]: 'Unable to resolve requested oid',
};

export async function createBundle(options: {
  readonly baseURL: string;
  readonly sessionToken: string;
  readonly files: IFiles;
  readonly source: string;
}): Promise<IResult<RemoteBundle, CreateBundleErrorCodes>> {
  const { baseURL, sessionToken, files, source } = options;

  try {
    const payload: Payload = {
      headers: { 'Session-Token': sessionToken, source },
      url: `${baseURL}${apiPath}/bundle`,
      method: 'post',
      body: {
        files,
      },
    };

    const response = await makeRequest(payload);

    return { type: 'success', value: response.body as RemoteBundle };
  } catch (error) {
    // todo
    return generateError<CreateBundleErrorCodes>(error, CREATE_BUNDLE_ERROR_MESSAGES, 'createBundle');
  }
}

export type CheckBundleErrorCodes =
  | GenericErrorTypes
  | ErrorCodes.unauthorizedUser
  | ErrorCodes.unauthorizedBundleAccess
  | ErrorCodes.notFound;

const CHECK_BUNDLE_ERROR_MESSAGES: { [P in CheckBundleErrorCodes]: string } = {
  ...GENERIC_ERROR_MESSAGES,
  [ErrorCodes.unauthorizedUser]: DEFAULT_ERROR_MESSAGES[ErrorCodes.unauthorizedUser],
  [ErrorCodes.unauthorizedBundleAccess]: DEFAULT_ERROR_MESSAGES[ErrorCodes.unauthorizedBundleAccess],
  [ErrorCodes.notFound]: 'Uploaded bundle has expired',
};

export async function checkBundle(options: {
  readonly baseURL: string;
  readonly sessionToken: string;
  readonly bundleId: string;
}): Promise<IResult<RemoteBundle, CheckBundleErrorCodes>> {
  const { baseURL, sessionToken, bundleId } = options;

  try {
    const response = await makeRequest({
      headers: { 'Session-Token': sessionToken },
      url: `${baseURL}${apiPath}/bundle/${bundleId}`,
      method: 'get',
    });

    return { type: 'success', value: response.body as RemoteBundle };
  } catch (error) {
    // todo
    return generateError<CheckBundleErrorCodes>(error, CHECK_BUNDLE_ERROR_MESSAGES, 'checkBundle');
  }
}

export type ExtendBundleErrorCodes =
  | GenericErrorTypes
  | ErrorCodes.unauthorizedUser
  | ErrorCodes.unauthorizedContent
  | ErrorCodes.unauthorizedBundleAccess
  | ErrorCodes.bigPayload
  | ErrorCodes.notFound;

const EXTEND_BUNDLE_ERROR_MESSAGES: { [P in ExtendBundleErrorCodes]: string } = {
  ...GENERIC_ERROR_MESSAGES,
  [ErrorCodes.unauthorizedUser]: DEFAULT_ERROR_MESSAGES[ErrorCodes.unauthorizedUser],
  [ErrorCodes.bigPayload]: DEFAULT_ERROR_MESSAGES[ErrorCodes.bigPayload],
  [ErrorCodes.unauthorizedContent]: `Attempted to extend a git bundle, or ended up with an empty bundle after the extension`,
  [ErrorCodes.unauthorizedBundleAccess]: 'Unauthorized access to parent bundle',
  [ErrorCodes.notFound]: 'Parent bundle has expired',
};

export async function extendBundle(options: {
  readonly baseURL: string;
  readonly sessionToken: string;
  readonly bundleId: string;
  readonly files: IFiles;
  readonly removedFiles?: string[];
}): Promise<IResult<RemoteBundle, ExtendBundleErrorCodes>> {
  const { baseURL, sessionToken, bundleId, files, removedFiles = [] } = options;

  try {
    const response = await makeRequest({
      headers: { 'Session-Token': sessionToken },
      url: `${baseURL}${apiPath}/bundle/${bundleId}`,
      method: 'put',
      body: {
        files,
        removedFiles,
      },
    });

    return { type: 'success', value: response.body as RemoteBundle };
  } catch (error) {
    // todo
    return generateError<ExtendBundleErrorCodes>(error, EXTEND_BUNDLE_ERROR_MESSAGES, 'extendBundle');
  }
}

type CreateGitBundleErrorCodes =
  | GenericErrorTypes
  | ErrorCodes.unauthorizedUser
  | ErrorCodes.unauthorizedBundleAccess
  | ErrorCodes.notFound;

const CREATE_GIT_BUNDLE_ERROR_MESSAGES: { [P in CreateGitBundleErrorCodes]: string } = {
  ...GENERIC_ERROR_MESSAGES,
  [ErrorCodes.unauthorizedUser]: DEFAULT_ERROR_MESSAGES[ErrorCodes.unauthorizedUser],
  [ErrorCodes.unauthorizedBundleAccess]: DEFAULT_ERROR_MESSAGES[ErrorCodes.unauthorizedBundleAccess],
  [ErrorCodes.notFound]: 'Unable to found requested repository or commit hash',
};

export async function createGitBundle(
  options: {
    readonly baseURL: string;
    readonly sessionToken: string;
    readonly oAuthToken?: string;
    readonly username?: string;
    readonly gitUri: string;
    readonly source: string;
  },
  requestOptions?: RequestOptions,
): Promise<IResult<RemoteBundle, CreateGitBundleErrorCodes>> {
  const { baseURL, sessionToken, oAuthToken, username, gitUri, source } = options;
  const headers = { ...requestOptions?.headers, 'Session-Token': sessionToken, source };
  if (oAuthToken) {
    headers['X-OAuthToken'] = oAuthToken;
  }
  if (username) {
    headers['X-UserName'] = username;
  }

  try {
    const response = await makeRequest({
      headers,
      url: `${baseURL}${apiPath}/bundle`,
      method: 'post',
      body: { gitURI: gitUri },
    });

    return { type: 'success', value: response.body as RemoteBundle };
  } catch (error) {
    // todo
    return generateError<CreateGitBundleErrorCodes>(error, CREATE_GIT_BUNDLE_ERROR_MESSAGES, 'createBundle');
  }
}

type UploadBundleErrorCodes =
  | GenericErrorTypes
  | ErrorCodes.unauthorizedUser
  | ErrorCodes.unauthorizedContent
  | ErrorCodes.unauthorizedBundleAccess
  | ErrorCodes.notFound
  | ErrorCodes.bigPayload;

const UPLOAD_BUNDLE_ERROR_MESSAGES: { [P in UploadBundleErrorCodes]: string } = {
  ...GENERIC_ERROR_MESSAGES,
  [ErrorCodes.unauthorizedUser]: DEFAULT_ERROR_MESSAGES[ErrorCodes.unauthorizedUser],
  [ErrorCodes.unauthorizedBundleAccess]: DEFAULT_ERROR_MESSAGES[ErrorCodes.unauthorizedBundleAccess],
  [ErrorCodes.notFound]: DEFAULT_ERROR_MESSAGES[ErrorCodes.notFound],
  [ErrorCodes.bigPayload]: DEFAULT_ERROR_MESSAGES[ErrorCodes.bigPayload],
  [ErrorCodes.unauthorizedContent]: `Invalid request, attempted to extend a git bundle, or ended up with an empty bundle after the extension`,
};

export async function uploadFiles(options: {
  readonly baseURL: string;
  readonly sessionToken: string;
  readonly bundleId: string;
  readonly content: IFileContent[];
}): Promise<IResult<boolean, UploadBundleErrorCodes>> {
  const { baseURL, sessionToken, bundleId, content } = options;

  try {
    await makeRequest({
      headers: { 'Session-Token': sessionToken },
      url: `${baseURL}${apiPath}/file/${bundleId}`,
      method: 'post',
      body: content,
    });

    return { type: 'success', value: true };
  } catch (error) {
    // todo
    return generateError<UploadBundleErrorCodes>(error, UPLOAD_BUNDLE_ERROR_MESSAGES, 'uploadFiles');
  }
}

// eslint-disable-next-line no-shadow
export enum AnalysisStatus {
  waiting = 'WAITING',
  fetching = 'FETCHING',
  analyzing = 'ANALYZING',
  dcDone = 'DC_DONE',
  done = 'DONE',
  failed = 'FAILED',
}

export type AnalysisResponseProgress = {
  readonly status: AnalysisStatus.waiting | AnalysisStatus.fetching | AnalysisStatus.analyzing | AnalysisStatus.dcDone;
  readonly progress: number;
};

export type AnalysisFailedResponse = {
  readonly status: AnalysisStatus.failed;
};

export type AnalysisFinishedResponse = {
  readonly status: AnalysisStatus.done;
  readonly analysisURL: string;
  readonly analysisResults: IAnalysisResult;
};

export type GetAnalysisResponseDto = AnalysisFinishedResponse | AnalysisFailedResponse | AnalysisResponseProgress;

export type GetAnalysisErrorCodes =
  | GenericErrorTypes
  | ErrorCodes.unauthorizedUser
  | ErrorCodes.unauthorizedBundleAccess
  | ErrorCodes.notFound;

const GET_ANALYSIS_ERROR_MESSAGES: { [P in GetAnalysisErrorCodes]: string } = {
  ...GENERIC_ERROR_MESSAGES,
  [ErrorCodes.unauthorizedUser]: DEFAULT_ERROR_MESSAGES[ErrorCodes.unauthorizedUser],
  [ErrorCodes.unauthorizedBundleAccess]: DEFAULT_ERROR_MESSAGES[ErrorCodes.unauthorizedBundleAccess],
  [ErrorCodes.notFound]: DEFAULT_ERROR_MESSAGES[ErrorCodes.notFound],
  [ErrorCodes.serverError]: 'Getting analysis failed',
};

export async function getAnalysis(
  options: {
    readonly baseURL: string;
    readonly sessionToken: string;
    readonly bundleId: string;
    readonly includeLint?: boolean;
    readonly severity: number;
    readonly limitToFiles?: string[];
    readonly oAuthToken?: string;
    readonly username?: string;
    readonly source: string;
    readonly reachability?: boolean;
  },
  requestOptions?: RequestOptions,
): Promise<IResult<GetAnalysisResponseDto, GetAnalysisErrorCodes>> {
  const {
    baseURL,
    sessionToken,
    oAuthToken,
    username,
    bundleId,
    includeLint,
    severity,
    limitToFiles,
    source,
    reachability,
  } = options;
  // ?linters=false is still a truthy query value, if(includeLint === false) we have to avoid sending the value altogether
  // the same applies for reachability
  const params = { severity, linters: includeLint || undefined, reachability: reachability || undefined };

  const headers = { ...requestOptions?.headers, 'Session-Token': sessionToken, source };
  if (oAuthToken) {
    headers['X-OAuthToken'] = oAuthToken;
  }
  if (username) {
    headers['X-UserName'] = username;
  }

  const config: Payload = {
    headers,
    qs: params,
    url: `${baseURL}${apiPath}/analysis/${bundleId}`,
    method: 'get',
  };

  if (limitToFiles && limitToFiles.length) {
    config.body = { files: limitToFiles };
    config.method = 'get';
  }

  try {
    const response = await makeRequest(config);
    return { type: 'success', value: response.body as GetAnalysisResponseDto };
  } catch (error) {
    return generateError<GetAnalysisErrorCodes>(error, GET_ANALYSIS_ERROR_MESSAGES, 'getAnalysis');
  }
}

type ReportTelemetryRequestDto = {
  readonly baseURL: string;
  readonly sessionToken?: string;
  readonly source?: string;
  readonly type?: string;
  readonly message?: string;
  readonly path?: string;
  readonly bundleId?: string;
  readonly version?: string;
  readonly environmentVersion?: string;
  readonly data?: any;
};

export async function reportError(options: ReportTelemetryRequestDto): Promise<IResult<void, GenericErrorTypes>> {
  const { baseURL, sessionToken, source, type, message, path, bundleId, version, environmentVersion, data } = options;
  const config: Payload = {
    url: `${baseURL}${apiPath}/error`,
    method: 'post',
    body: {
      sessionToken,
      source,
      type,
      message,
      path,
      bundleId,
      version,
      environmentVersion,
      data,
    },
  };

  try {
    await makeRequest(config);
    return { type: 'success', value: undefined };
  } catch (error) {
    return generateError<GenericErrorTypes>(error, GENERIC_ERROR_MESSAGES, 'reportError');
  }
}

export async function reportEvent(options: ReportTelemetryRequestDto): Promise<IResult<void, GenericErrorTypes>> {
  const { baseURL, sessionToken, source, type, message, path, bundleId, version, environmentVersion, data } = options;
  const config: Payload = {
    url: `${baseURL}${apiPath}/track`,
    method: 'post',
    body: {
      sessionToken,
      source,
      type,
      message,
      path,
      bundleId,
      version,
      environmentVersion,
      data,
    },
  };

  try {
    await makeRequest(config);
    return { type: 'success', value: undefined };
  } catch (error) {
    return generateError<GenericErrorTypes>(error, GENERIC_ERROR_MESSAGES, 'reportEvent');
  }
}
