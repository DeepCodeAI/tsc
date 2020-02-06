import { ServiceAI } from '../src/index';
import { baseConfig, sessionToken, bundleId, expiredBundleId } from './mocks/base-config';

import { ErrorResponseDto } from '../src/dto/error.response.dto';
import { StartSessionRequestDto } from '../src/dto/start-session.request.dto';
import { CheckSessionRequestDto } from '../src/dto/check-session.request.dto';
import { GetFiltersRequestDto } from '../src/dto/get-filters.request.dto';
import { CheckBundleRequestDto } from '../src/dto/check-bundle.request.dto';
import { GetAnalysisRequestDto } from '../src/dto/get-analysis.request.dto';

import { startMockServer } from './mocks/mock-server';
import {
  createBundleRequest,
  extendBundleRequest,
  extendBundleRequestExpired,
  uploadFilesRequest,
} from './mocks/requests';
import {
  startSessionResponse,
  checkSessionResponse,
  getFiltersResponse,
  createBundleResponse,
  checkBundleResponse,
  extendBundleResponse,
  uploadFilesResponse,
  getAnalysisResponse,

  checkBundleError404,
  extendBundleError404,
} from './mocks/responses';

startMockServer();

describe('Requests to public API', () => {

  const AI = new ServiceAI();
  AI.init(baseConfig);

  /**
   * Start Session
   */
  it('starts session successfully', async () => {
    const options = new StartSessionRequestDto({
      source: 'atom',
    });

    const response = await AI.startSession(options);
    expect(response).toEqual(startSessionResponse);
  });

  /**
   * Check Session
   */
  it('checks session successfully', async () => {
    const options = new CheckSessionRequestDto({
      sessionToken,
    });

    const response = await AI.checkSession(options);
    expect(response).toEqual(checkSessionResponse);
  });

  /**
   * Get filters
   */
  it('gets filters successfully', async () => {
    const options = new GetFiltersRequestDto({
      sessionToken,
    });

    const response = await AI.getFilters(options);
    expect(response).toEqual(getFiltersResponse);
  });

  /**
   * Create Bundle
   */
  it('creates bundle successfully', async () => {
    const response = await AI.createBundle(createBundleRequest);
    expect(response).toEqual(createBundleResponse);
  });

  /**
   * Check Bundle
   */
  it('checks bundle successfully', async () => {
    const options = new CheckBundleRequestDto({
      sessionToken,
      bundleId,
    });

    const response = await AI.checkBundle(options);
    expect(response).toEqual(checkBundleResponse);
  });

  it('checks expired bundle successfully', async () => {
    const options = new CheckBundleRequestDto({
      sessionToken,
      bundleId: expiredBundleId,
    });

    let response: ErrorResponseDto;
    try {
      await AI.checkBundle(options);
      response = new ErrorResponseDto({});
    } catch (error) {
      response = {
        error: {},
        statusCode: error.statusCode,
        statusText: error.statusText,
      };
    }

    expect(response).toEqual(checkBundleError404);
  });

  /**
   * Extend Bundle
   */
  it('extends bundle successfully', async () => {
    const response = await AI.extendBundle(extendBundleRequest);
    expect(response).toEqual(extendBundleResponse);
  });

  it('extends expired bundle successfully', async () => {
    let response: ErrorResponseDto;
    try {
      await AI.extendBundle(extendBundleRequestExpired);
      response = new ErrorResponseDto({});
    } catch (error) {
      response = {
        error: {},
        statusCode: error.statusCode,
        statusText: error.statusText,
      };
    }

    expect(response).toEqual(extendBundleError404);
  });

  /**
   * Upload Files
   */
  it('uploads files successfully', async () => {
    const response = await AI.uploadFiles(uploadFilesRequest);
    expect(response).toEqual(uploadFilesResponse);
  });

  /**
   * Get Analysis
   */
  it('gets analysis successfully', async () => {
    const options = new GetAnalysisRequestDto({
      sessionToken,
      bundleId,
    });

    const response = await AI.getAnalysis(options);
    expect(response).toEqual(getAnalysisResponse);
  });
});