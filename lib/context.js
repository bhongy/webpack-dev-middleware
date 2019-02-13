'use strict';

const weblog = require('webpack-log');

// note: `state: true` means it's valid and can be built

// 1) build (and return) a `context` object
// contiaining:
// - (internal) flags: state, watching, forceRebuild
// - (internal) methods: log, rebuild
// - current webpack stats (mutated)
// 2) attach listeners to compiler hooks (done, run, etc)
module.exports = function ctx(compiler, options) {
  const context = {
    state: false,
    webpackStats: null,
    callbacks: [],
    options,
    compiler,
    watching: null,
    forceRebuild: false
  };

  if (options.logger) {
    context.log = options.logger;
  } else {
    context.log = weblog({
      level: options.logLevel || 'info',
      name: 'wdm',
      timestamp: options.logTime
    });
  }

  const { log } = context;

  // force state to valid (this is the only place that flips this flag to `true`)
  // schedule nextTick
  // -> report webpack compilation stats
  // -> execute callbacks that are delayed (e.g. things that we asked to do when the compilation is not done)
  function done(stats) {
    // We are now on valid state
    context.state = true;
    context.webpackStats = stats;

    // Do the stuff in nextTick, because bundle may be invalidated
    // if a change happened while compiling
    process.nextTick(() => {
      // check if still in valid state
      if (!context.state) {
        return;
      }

      // print webpack output
      context.options.reporter(context.options, {
        log,
        state: true,
        stats
      });

      // execute callback that are delayed
      const cbs = context.callbacks;
      context.callbacks = [];
      cbs.forEach((cb) => {
        cb(stats);
      });
    });

    // In lazy mode, we may issue another rebuild
    if (context.forceRebuild) {
      context.forceRebuild = false;
      rebuild();
    }
  }

  // observation: reads the current value of context.state in the closure
  // -> log if state is valid
  // -> **set state to invalid**
  // -> call the (single) passed in callback
  function invalid(callback) {
    if (context.state) {
      context.options.reporter(context.options, {
        log,
        state: false
      });
    }

    // We are now in invalid state
    context.state = false;
    if (typeof callback === 'function') {
      callback();
    }
  }

  // if state is valid
  // -> set state to invalid
  // -> call compiler.run directly
  // otherwise set flag `forceRebuild` << is this only for lazy?
  function rebuild() {
    if (context.state) {
      context.state = false;
      context.compiler.run((err) => {
        if (err) {
          log.error(err.stack || err);
          if (err.details) {
            log.error(err.details);
          }
        }
      });
    } else {
      context.forceRebuild = true;
    }
  }

  context.rebuild = rebuild;
  context.compiler.hooks.invalid.tap('WebpackDevMiddleware', invalid);
  context.compiler.hooks.run.tap('WebpackDevMiddleware', invalid);
  context.compiler.hooks.done.tap('WebpackDevMiddleware', done);
  context.compiler.hooks.watchRun.tap('WebpackDevMiddleware', (comp, callback) => {
    invalid(callback);
  });

  return context;
};
