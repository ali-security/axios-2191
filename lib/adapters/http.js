'use strict';

var utils = require('./../utils');
var settle = require('./../core/settle');
var buildFullPath = require('../core/buildFullPath');
var buildURL = require('./../helpers/buildURL');
var http = require('http');
var https = require('https');
var httpFollow = require('follow-redirects').http;
var httpsFollow = require('follow-redirects').https;
var url = require('url');
var zlib = require('zlib');
var stream = require('stream');
var pkg = require('./../../package.json');
var createError = require('../core/createError');
var enhanceError = require('../core/enhanceError');
var estimateDataURLDecodedBytes = require('../helpers/estimateDataURLDecodedBytes');
var shouldBypassProxy = require('../helpers/shouldBypassProxy');

var isHttps = /https:?/;

/**
 *
 * @param {http.ClientRequestArgs} options
 * @param {AxiosProxyConfig} proxy
 * @param {string} location
 */
function setProxy(options, proxy, location) {
  options.hostname = proxy.host;
  options.host = proxy.host;
  options.port = proxy.port;
  options.path = location;

  // Basic proxy authorization
  var proxyAuth = utils.hasOwnProperty(proxy, 'auth')
    ? proxy.auth
    : undefined;
  if (proxyAuth) {
    var proxyUsername = utils.hasOwnProperty(proxyAuth, 'username')
      ? proxyAuth.username
      : '';
    var proxyPassword = utils.hasOwnProperty(proxyAuth, 'password')
      ? proxyAuth.password
      : '';
    var base64 = Buffer.from(proxyUsername + ':' + proxyPassword, 'utf8').toString('base64');
    options.headers['Proxy-Authorization'] = 'Basic ' + base64;
  }

  // If a proxy is used, any redirects must also pass through the proxy
  options.beforeRedirect = function beforeRedirect(redirection) {
    redirection.headers.host = redirection.host;
    setProxy(redirection, proxy, redirection.href);
  };
}

/*eslint consistent-return:0*/
module.exports = function httpAdapter(config) {
  return new Promise(function dispatchHttpRequest(resolvePromise, rejectPromise) {
    var rejected = false;
    var resolve = function resolve(value) {
      resolvePromise(value);
    };
    var reject = function reject(value) {
      rejected = true;
      rejectPromise(value);
    };
    var data = config.data;
    var headers = config.headers;

    // Set User-Agent (required by some servers)
    // See https://github.com/axios/axios/issues/69
    if ('User-Agent' in headers || 'user-agent' in headers) {
      // User-Agent is specified; handle case where no UA header is desired
      if (!headers['User-Agent'] && !headers['user-agent']) {
        delete headers['User-Agent'];
        delete headers['user-agent'];
      }
      // Otherwise, use specified value
    } else {
      // Only set header if it hasn't been set in config
      headers['User-Agent'] = 'axios/' + pkg.version;
    }

    if (data && !utils.isStream(data)) {
      if (Buffer.isBuffer(data)) {
        // Nothing to do...
      } else if (utils.isArrayBuffer(data)) {
        data = Buffer.from(new Uint8Array(data));
      } else if (utils.isString(data)) {
        data = Buffer.from(data, 'utf-8');
      } else {
        return reject(createError(
          'Data after transformation must be a string, an ArrayBuffer, a Buffer, or a Stream',
          config
        ));
      }

      // Add Content-Length header if data exists
      headers['Content-Length'] = data.length;
    }

    // HTTP basic authentication
    var auth = undefined;
    if (config.auth) {
      var username = config.auth.username || '';
      var password = config.auth.password || '';
      auth = username + ':' + password;
    }

    // Parse url
    var fullPath = buildFullPath(config.baseURL, config.url, config.allowAbsoluteUrls);
    var parsed = url.parse(fullPath);
    var protocol = parsed.protocol || 'http:';

    // CVE-2025-58754: Check maxContentLength for data: URLs to prevent unbounded memory allocation
    if (protocol === 'data:') {
      // Apply the same semantics as HTTP: only enforce if a finite, non-negative cap is set.
      if (config.maxContentLength > -1) {
        var dataUrl = String(config.url || fullPath || '');
        var estimated = estimateDataURLDecodedBytes(dataUrl);

        if (estimated > config.maxContentLength) {
          return reject(createError(
            'maxContentLength size of ' + config.maxContentLength + ' exceeded',
            config,
            'ERR_BAD_RESPONSE',
            null
          ));
        }
      }
    }

    if (!auth && parsed.auth) {
      var urlAuth = parsed.auth.split(':');
      var urlUsername = urlAuth[0] || '';
      var urlPassword = urlAuth[1] || '';
      auth = urlUsername + ':' + urlPassword;
    }

    if (auth) {
      delete headers.Authorization;
    }

    var isHttpsRequest = isHttps.test(protocol);
    var agent = isHttpsRequest ? config.httpsAgent : config.httpAgent;

    var options = {
      path: buildURL(parsed.path, config.params, config.paramsSerializer).replace(/^\?/, ''),
      method: config.method.toUpperCase(),
      headers: headers,
      agent: agent,
      agents: { http: config.httpAgent, https: config.httpsAgent },
      auth: auth
    };

    if (config.socketPath) {
      options.socketPath = config.socketPath;
    } else {
      options.hostname = parsed.hostname;
      options.port = parsed.port;
    }

    var proxy = config.proxy;
    var location = protocol + '//' + parsed.host + options.path;
    if (!proxy && proxy !== false) {
      var proxyEnv = protocol.slice(0, -1) + '_proxy';
      var proxyUrl = process.env[proxyEnv] || process.env[proxyEnv.toUpperCase()];
      if (proxyUrl && !shouldBypassProxy(location)) {
        var parsedProxyUrl = url.parse(proxyUrl);

        proxy = {
          host: parsedProxyUrl.hostname,
          port: parsedProxyUrl.port,
          protocol: parsedProxyUrl.protocol
        };

        if (parsedProxyUrl.auth) {
          var proxyUrlAuth = parsedProxyUrl.auth.split(':');
          proxy.auth = {
            username: proxyUrlAuth[0],
            password: proxyUrlAuth[1]
          };
        }
      }
    }

    if (proxy) {
      options.headers.host = parsed.hostname + (parsed.port ? ':' + parsed.port : '');
      setProxy(options, proxy, location);
    }

    var transport;
    var isHttpsProxy = isHttpsRequest && (proxy ? isHttps.test(proxy.protocol) : true);
    if (utils.hasOwnProperty(config, 'transport') && config.transport) {
      transport = config.transport;
    } else if (config.maxRedirects === 0) {
      transport = isHttpsProxy ? https : http;
    } else {
      if (config.maxRedirects) {
        options.maxRedirects = config.maxRedirects;
      }
      transport = isHttpsProxy ? httpsFollow : httpFollow;
    }

    if (config.maxBodyLength > -1) {
      options.maxBodyLength = config.maxBodyLength;
    }

    if (config.insecureHTTPParser) {
      options.insecureHTTPParser = config.insecureHTTPParser;
    }

    // Create the request
    var req = transport.request(options, function handleResponse(res) {
      if (req.aborted) return;

      // uncompress the response body transparently if required
      var responseStream = res;

      // return the last request in case of redirects
      var lastRequest = res.req || req;


      // if no content, is HEAD request or decompress disabled we should not decompress
      if (res.statusCode !== 204 && lastRequest.method !== 'HEAD' && config.decompress !== false) {
        switch (res.headers['content-encoding']) {
        /*eslint default-case:0*/
        case 'gzip':
        case 'compress':
        case 'deflate':
        // add the unzipper to the body stream processing pipeline
          responseStream = responseStream.pipe(zlib.createUnzip());

          // remove the content-encoding in order to not confuse downstream operations
          delete res.headers['content-encoding'];
          break;
        }
      }

      var response = {
        status: res.statusCode,
        statusText: res.statusMessage,
        headers: res.headers,
        config: config,
        request: lastRequest
      };

      if (config.responseType === 'stream') {
        // Enforce maxContentLength on streamed responses too (GHSA-vf2m-468p-8v99).
        // Previously the stream path bypassed the size guard because the check only
        // ran on the buffering branch.
        if (config.maxContentLength > -1) {
          var maxContentLength = config.maxContentLength;
          var streamedBytes = 0;
          var limiter = new stream.Transform({
            transform: function transformChunk(chunk, encoding, callback) {
              streamedBytes += chunk.length;
              if (streamedBytes > maxContentLength) {
                callback(createError(
                  'maxContentLength size of ' + maxContentLength + ' exceeded',
                  config,
                  'ERR_BAD_RESPONSE',
                  lastRequest
                ));
                return;
              }
              callback(null, chunk);
            }
          });
          limiter.on('error', function handleLimiterError() {
            rejected = true;
            responseStream.destroy();
          });
          responseStream.on('error', function forwardError(err) {
            limiter.destroy(err);
          });
          response.data = limiter;
          settle(resolve, reject, response);
          // Defer piping via setImmediate so the caller's `.then` (a microtask)
          // has run and attached any `error`/`data` listeners before chunks flow
          // through the transform. `process.nextTick` would drain before those
          // microtasks and lose the error event.
          setImmediate(function startPipe() {
            responseStream.pipe(limiter);
          });
        } else {
          response.data = responseStream;
          settle(resolve, reject, response);
        }
      } else {
        var responseBuffer = [];
        var totalResponseBytes = 0;
        responseStream.on('data', function handleStreamData(chunk) {
          responseBuffer.push(chunk);
          totalResponseBytes += chunk.length;

          // make sure the content length is not over the maxContentLength if specified
          if (config.maxContentLength > -1 && totalResponseBytes > config.maxContentLength) {
            responseStream.destroy();
            reject(createError('maxContentLength size of ' + config.maxContentLength + ' exceeded',
              config, null, lastRequest));
          }
        });

        responseStream.on('error', function handleStreamError(err) {
          if (req.aborted) return;
          reject(enhanceError(err, config, null, lastRequest));
        });

        responseStream.on('end', function handleStreamEnd() {
          var responseData = Buffer.concat(responseBuffer);
          if (config.responseType !== 'arraybuffer') {
            responseData = responseData.toString(config.responseEncoding);
            if (!config.responseEncoding || config.responseEncoding === 'utf8') {
              responseData = utils.stripBOM(responseData);
            }
          }

          response.data = responseData;
          settle(resolve, reject, response);
        });
      }
    });

    // Handle errors
    req.on('error', function handleRequestError(err) {
      if (req.aborted && err.code !== 'ERR_FR_TOO_MANY_REDIRECTS') return;
      reject(enhanceError(err, config, null, req));
    });

    // Handle request timeout
    if (config.timeout) {
      // Force an int timeout so the `req` interface gets a clean number.
      // The try/catch is required: merged config values have a null prototype,
      // and parseInt on a null-prototype object throws "Cannot convert object
      // to primitive value" because there is no inherited toString. Treating
      // that as NaN routes to the same ERR_PARSE_TIMEOUT rejection as any
      // other unparsable value.
      var timeout;
      try {
        timeout = parseInt(config.timeout, 10);
      } catch (err) {
        timeout = NaN;
      }

      if (isNaN(timeout)) {
        reject(createError(
          'error trying to parse `config.timeout` to int',
          config,
          'ERR_PARSE_TIMEOUT',
          req
        ));

        return;
      }

      // Sometime, the response will be very slow, and does not respond, the connect event will be block by event loop system.
      // And timer callback will be fired, and abort() will be invoked before connection, then get "socket hang up" and code ECONNRESET.
      // At this time, if we have a large number of request, nodejs will hang up some socket on background. and the number will up and up.
      // And then these socket which be hang up will devoring CPU little by little.
      // ClientRequest.setTimeout will be fired on the specify milliseconds, and can make sure that abort() will be fired after connect.
      req.setTimeout(timeout, function handleRequestTimeout() {
        req.abort();
        reject(createError(
          'timeout of ' + timeout + 'ms exceeded',
          config,
          config.transitional && config.transitional.clarifyTimeoutError ? 'ETIMEDOUT' : 'ECONNABORTED',
          req
        ));
      });
    }

    if (config.cancelToken) {
      // Handle cancellation
      config.cancelToken.promise.then(function onCanceled(cancel) {
        if (req.aborted) return;

        req.abort();
        reject(cancel);
      });
    }

    // Send the request
    if (utils.isStream(data)) {
      data.on('error', function handleStreamError(err) {
        reject(enhanceError(err, config, null, req));
      });

      // follow-redirects enforces options.maxBodyLength for stream uploads, but the
      // native http/https transport (used when maxRedirects === 0) does not.
      // Count bytes ourselves so the limit is always honored (GHSA-5c9x-8gcm-mpgx).
      var nativeTransport = transport === http || transport === https;
      if (nativeTransport && config.maxBodyLength > -1) {
        var maxBodyLength = config.maxBodyLength;
        var uploadedBytes = 0;
        var bodyLimiter = new stream.Transform({
          transform: function transformChunk(chunk, encoding, callback) {
            uploadedBytes += chunk.length;
            if (uploadedBytes > maxBodyLength) {
              callback(createError(
                'Request body larger than maxBodyLength limit',
                config,
                'ERR_BAD_REQUEST',
                req
              ));
              return;
            }
            callback(null, chunk);
          }
        });
        bodyLimiter.on('error', function handleLimiterError(err) {
          if (rejected) return;
          rejected = true;
          try { data.unpipe(bodyLimiter); } catch (e) { /* noop */ }
          try { bodyLimiter.unpipe(req); } catch (e) { /* noop */ }
          req.destroy();
          reject(err);
        });
        data.pipe(bodyLimiter).pipe(req);
      } else {
        data.pipe(req);
      }
    } else {
      req.end(data);
    }
  });
};
