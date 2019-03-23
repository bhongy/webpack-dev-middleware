'use strict';

const path = require('path');
const mime = require('mime');
const DevMiddlewareError = require('./DevMiddlewareError');
const { getFilenameFromUrl, handleRangeHeaders, handleRequest, ready } = require('./util');

module.exports = function wrapper(context) {
  return function middleware(req, res, next) {
    // fixes #282. credit @cexoso. in certain edge situations res.locals is
    // undefined.
    res.locals = res.locals || {};

    // won't move on to the next middleware until the compilation is ready
    // `ready` is a way to "schedule" what to do on "done" while the compilation is not done
    function goNext() {
      if (!context.options.serverSideRender) {
        return next();
      }

      return new Promise(((resolve) => {
        ready(context, () => {
          res.locals.webpackStats = context.webpackStats;
          res.locals.fs = context.fs;
          resolve(next());
        }, req);
      }));
    }

    const acceptedMethods = context.options.methods || ['GET'];
    if (acceptedMethods.indexOf(req.method) === -1) {
      return goNext();
    }

    // see if it's a request to a file built via webpack (static assets)
    // if not "goNext" (don't do anything) let the next middleware handle it
    // if so read the file content from disk and end the response
    // ---
    // this only figure out the filename (string)
    // but does not check if the file exists (which is done in `processRequest`)
    let filename = getFilenameFromUrl(context.options.publicPath, context.compiler, req.url);

    if (filename === false) {
      return goNext();
    }

    return new Promise(((resolve) => {
      handleRequest(context, filename, processRequest, req);
      // this handler is **only** to serve files bundled by webpack
      // "handle" == set response headers and call `res.end(content)`
      function processRequest() {
        // just check if the file actually existed
        // ---
        // this uses try-catch for control flow ¯\_(ツ)_/¯
        // if everything is good, it'll pass through silently (no values set)
        // if something fails, it returns early in `catch` block
        try {
          let stat = context.fs.statSync(filename);

          if (!stat.isFile()) {
            if (stat.isDirectory()) {
              let { index } = context.options;

              if (index === undefined || index === true) {
                index = 'index.html';
              // other falsy values besides `undefined` or `true`
              } else if (!index) {
                throw new DevMiddlewareError('next');
              }

              filename = path.posix.join(filename, index);
              stat = context.fs.statSync(filename);
              if (!stat.isFile()) {
                throw new DevMiddlewareError('next');
              }
            } else {
              throw new DevMiddlewareError('next');
            }
          }
        // any issue in try block (which it manually throws a lot)
        // do nothing -> pass control to the next middleware
        } catch (e) {
          return resolve(goNext());
        }

        // --- serve static file (built by webpack)
        // read from disk and send the content

        // server content
        let content /* Buffer */ = context.fs.readFileSync(filename);
        // handle case when `req.headers.range` is requested
        // i.e. send portion of a large static file or allowing pause/resume
        // if range is handled, `content` here is the **partial content**
        // based on request range header
        content = handleRangeHeaders(content, req, res);

        let contentType = mime.getType(filename) || '';

        // do not add charset to WebAssembly files, otherwise compileStreaming will fail in the client
        if (!/\.wasm$/.test(filename)) {
          contentType += '; charset=UTF-8';
        }

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', content.length);

        const { headers } = context.options;
        if (headers) {
          for (const name in headers) {
            if ({}.hasOwnProperty.call(headers, name)) {
              res.setHeader(name, context.options.headers[name]);
            }
          }
        }
        // this part just tries to normalize different res.write/end APIs (node.http, express)
        // Express automatically sets the statusCode to 200, but not all servers do (Koa).
        res.statusCode = res.statusCode || 200;
        if (res.send) res.send(content);
        else res.end(content);
        resolve();
      }
    }));
  };
};
