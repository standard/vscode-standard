#!/usr/bin/env bash

CODE_TESTS_PATH="$(pwd)/client/out/test"
CODE_TESTS_WORKSPACE="$(pwd)/client/testFixture"
export CODE_TESTS_PATH
export CODE_TESTS_WORKSPACE

node "$(pwd)/client/out/test/runTests"
