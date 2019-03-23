'use strict';

const fs = require('fs');
const path = require('path');
const MemoryFileSystem = require('memory-fs');
const { colors } = require('webpack-log');
const NodeOutputFileSystem = require('webpack/lib/node/NodeOutputFileSystem');
const DevMiddlewareError = require('./DevMiddlewareError');

// for writing to disk: this is just `require('mkdirp')`
const { mkdirp } = new NodeOutputFileSystem();

module.exports = {
  // called if `options.writeToDisk` is set
  toDisk(context) {
    const compilers = context.compiler.compilers || [context.compiler];
    // do for all compilers concurrently
    for (const compiler of compilers) {
      // after emitting assets to output directory (MemoryFS)
      compiler.hooks.afterEmit.tap('WebpackDevMiddleware', (compilation) => {
        const { assets } = compilation;
        const { log } = context;
        // when `writeToDisk` is a function
        const { writeToDisk: filter } = context.options;
        let { outputPath } = compiler;

        if (outputPath === '/') {
          outputPath = compiler.context;
        }

        // write all assets (already emitted to Memory FS) to disk
        // - sanitize asset path to get relative path to `cwd`
        // - filter with `options.writeToDisk` if it's a function
        // - !!! all files are `writeFileSync` - block on I/O
        for (const assetPath of Object.keys(assets)) {
          const asset = assets[assetPath];
          const source = asset.source();
          const [assetPathClean] = assetPath.split('?');
          const isAbsolute = path.isAbsolute(assetPathClean);
          const writePath = isAbsolute ? assetPathClean : path.join(outputPath, assetPathClean);
          const relativePath = path.relative(process.cwd(), writePath);
          const allowWrite = filter && typeof filter === 'function' ? filter(writePath) : true;

          // manually call fs.mkdirp and fs.writeFile because
          // setFs always force the outputFileSystem to be MemoryFileSystem
          // even when we opt to write to disk
          // it just "also" emits to disk when `writeToDisk` is set
          if (allowWrite) {
            let output = source;

            mkdirp.sync(path.dirname(writePath));

            if (Array.isArray(source)) {
              output = source.join('\n');
            }

            try {
              fs.writeFileSync(writePath, output, 'utf-8');
              log.debug(colors.cyan(`Asset written to disk: ${relativePath}`));
            } catch (e) {
              log.error(`Unable to write asset to disk:\n${e}`);
            }
          }
        }
      });
    }
  },

  // always called when "instantiate" `wdm`
  // always set `context.fs` and `compiler.outputFileSystem` to MemoryFileSystem
  // even when `compiler.outputFileSystem` was set as something else
  setFs(context, compiler) {
    if (typeof compiler.outputPath === 'string' && !path.posix.isAbsolute(compiler.outputPath) && !path.win32.isAbsolute(compiler.outputPath)) {
      throw new DevMiddlewareError('`output.path` needs to be an absolute path or `/`.');
    }

    let fileSystem;

    // `true` only if it's a single compiler (not multi)
    //   and `compiler.outputFileSystem` is _already_ set to MemoryFileSystem
    // `false` for multicompiler (always)
    const isMemoryFs = !compiler.compilers && compiler.outputFileSystem instanceof MemoryFileSystem;

    // if already memory fs, use it
    if (isMemoryFs) {
      fileSystem = compiler.outputFileSystem;

    // if not currently use memory fs, override it and use memory fs
    } else {
      fileSystem = new MemoryFileSystem();
      // setting `outputFileSystem` on multicompiler
      // will set all of its compilers `outputFileSystem` to the value being set
      compiler.outputFileSystem = fileSystem;
    }

    context.fs = fileSystem;
  }
};
