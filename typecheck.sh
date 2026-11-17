#!/bin/sh
node node_modules/typescript/bin/tsc -p . && node node_modules/typescript/bin/tsc -p tsconfig.client.json
