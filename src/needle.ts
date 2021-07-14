import http, { OutgoingHttpHeaders } from 'http';
import * as needle from 'needle';
import https from 'https';
import emitter from './emitter';
import { NeedleHttpVerbs } from 'needle';
import * as querystring from 'querystring';
import { URL } from 'url';

// Snyk CLI allow passing --insecure flag which allows self-signed certificates
// It updates global namespace property ignoreUnknownCA and we can use it in order
// to pass rejectUnauthorized option to https agent
export declare interface Global extends NodeJS.Global {
  ignoreUnknownCA: boolean;
}
declare const global: Global;

const agentOptions = {
  keepAlive: true,
  maxSockets: 100, // Maximum number of sockets to allow per host. Defaults to Infinity.
  maxFreeSockets: 10,
  freeSocketTimeout: 60000, // // Maximum number of sockets to leave open for 60 seconds in a free state. Only relevant if keepAlive is set to true. Defaults to 256.
  socketActiveTTL: 1000 * 60 * 10,
  rejectUnauthorized: !global.ignoreUnknownCA,
};

export interface Payload {
  body?: any;
  url: string;
  headers?: OutgoingHttpHeaders;
  method: NeedleHttpVerbs;
  qs?: {};
  timeout?: number;
  family?: number;
}

export function makeRequest(payload: Payload): Promise<{ res: needle.NeedleResponse; body: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload.body);

    if (!payload.headers) {
      payload.headers = {
        'Content-Type': 'application/json;charset=utf-8',
      };
    }

    const parsedUrl = new URL(payload.url);

    const method = (payload.method || 'get').toLowerCase() as needle.NeedleHttpVerbs;
    let url = payload.url;

    if (payload.qs) {
      // Parse the URL and append the search part - this will take care of adding the '/?' part if it's missing
      const urlObject = new URL(url);
      urlObject.search = querystring.stringify(payload.qs);
      url = urlObject.toString();
      delete payload.qs;
    }

    const agent = parsedUrl.protocol === 'http:' ? new http.Agent(agentOptions) : new https.Agent(agentOptions);
    const options: needle.NeedleOptions = {
      json: true,
      headers: payload.headers,
      timeout: payload.timeout,
      // eslint-disable-next-line @typescript-eslint/camelcase
      follow_max: 5,
      family: payload.family,
      agent,
    };

    emitter.apiRequestLog(`=> HTTP ${method?.toUpperCase()} ${url} ${data ?? ''}`.slice(0, 399));

    needle.request(method, url, data, options, (err, res, respBody) => {
      if (err) {
        emitter.apiRequestLog(`Request error --> ${err.message}`);
        return reject(err);
      }

      emitter.apiRequestLog(`<= Response: ${res.statusCode} ${JSON.stringify(res.body)}`.slice(0, 399));
      resolve({ res, body: respBody });
    });
  });
}
