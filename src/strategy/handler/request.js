const http = require('http');
const https = require('https');
const stream = require('stream');

const DEFAULT_REQUEST_TIMEOUT = 2 * 60 * 1000;

function mergeRequestOptions(clientRequest, httpsTarget) {
	const url = new URL(httpsTarget ?
		`https://${httpsTarget.hostname}:${httpsTarget.port}${clientRequest.url}` :
		clientRequest.url);

	return {
		method: clientRequest.method,
		protocol: url.protocol,
		host: url.hostname,
		port: url.port,
		path: url.pathname + url.search,
		headers: clientRequest.headers,
		timeout: DEFAULT_REQUEST_TIMEOUT,
	}
}

module.exports = function createRequestHandlerFactory(requestInterceptor, responseInterceptor) {
	return function RequestHandlerFactory(httpsTarget) {
		return async function RequestHandler(clientRequest, clientResponse) {
			const ctx = {
				request: {
					options: mergeRequestOptions(clientRequest, httpsTarget),
					body: clientRequest,
				},
				response: {
					statusCode: null,
					statusMessage: null,
					header: null,
					body: null
				}
			};

			function respond() {
				clientResponse.statusCode = ctx.response.statusCode;
				clientResponse.statusMessage = ctx.response.statusMessage;

				Object.keys(ctx.response.header).forEach(key => {
					clientResponse.setHeader(key, ctx.response.header[key]);
				});

				if (ctx.response.body instanceof stream.Readable) {
					ctx.response.body.pipe(clientResponse);
				} else {
					clientResponse.end(ctx.response.body);
				}
			}

			await requestInterceptor(ctx, function forward() {
				const isHTTPS = ctx.request.options.protocol === 'https:';
				const proxyRequest = (isHTTPS ? https : http).request(ctx.request.options);

				proxyRequest.on('timeout', () => { });
				proxyRequest.on('error', error => { });
				proxyRequest.on('aborted', () => clientRequest.abort());
				clientRequest.on('aborted', () => proxyRequest.abort());

				proxyRequest.on('response', async proxyResponse => {
					delete proxyResponse.headers['content-length'];

					ctx.response.statusCode = proxyResponse.statusCode;
					ctx.response.statusMessage = proxyResponse.statusMessage;
					ctx.response.header = proxyResponse.headers;
					ctx.response.body = proxyResponse;

					await responseInterceptor(ctx, respond);
				});

				if (ctx.request.body instanceof stream.Readable) {
					ctx.request.body.pipe(proxyRequest);
				} else {
					proxyRequest.end(ctx.request.body);
				}
			}, respond);
		}
	}
}