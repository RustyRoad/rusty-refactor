import { defineConfig } from '@rsbuild/core';

const tsRule = {
  test: /\.ts$/,
  exclude: /node_modules/,
  use: {
    loader: 'builtin:swc-loader',
    options: {
      jsc: {
        parser: {
          syntax: 'typescript',
        },
        target: 'es2020',
      },
    },
  },
  type: 'javascript/auto',
};

export default defineConfig({
  environments: {
    extension: {
      source: {
        entry: {
          extension: './src/extension.ts',
        },
      },
      output: {
        target: 'node',
        distPath: {
          root: 'out',
          js: '',
        },
        filename: {
          js: '[name].js',
        },
        minify: false,
        cleanDistPath: false,
      },
      performance: {
        chunkSplit: {
          strategy: 'all-in-one',
        },
      },
      tools: {
        rspack: {
          externals: {
            vscode: 'commonjs vscode',
            bufferutil: 'commonjs bufferutil',
            'utf-8-validate': 'commonjs utf-8-validate',
          },
          externalsType: 'commonjs',
          output: {
            library: {
              type: 'commonjs2',
            },
          },
          module: {
            rules: [tsRule],
          },
        },
      },
    },
    webview: {
      source: {
        entry: {
          'chat-sidebar-markdown':
            './webview-src/codetether-chat/markdown.ts',
          'module-extractor': './webview-src/module-extractor/index.ts',
        },
      },
      output: {
        target: 'web',
        distPath: {
          root: 'out/webview',
          js: '',
          css: '',
        },
        filename: {
          js: '[name].js',
          css: '[name].css',
        },
        minify: false,
        cleanDistPath: false,
      },
      performance: {
        chunkSplit: {
          strategy: 'all-in-one',
        },
      },
      tools: {
        rspack: {
          module: {
            rules: [tsRule],
          },
        },
      },
    },
  },
});
