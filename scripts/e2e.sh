#!/usr/bin/env bash

CODE_TESTS_PATH="$(pwd)/client/out/test"
CODE_TESTS_WORKSPACE="$(pwd)/client/testFixture"
export CODE_TESTS_PATH
export CODE_TESTS_WORKSPACE

npm install --global standard
npm install --global semistandard
npm install --global standardx
npm install --global ts-standard typescript @types/node

node "$(pwd)/client/out/test/runTests"
