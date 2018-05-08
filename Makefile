.DEFAULT_GOAL := build

build:
	npm run clean:dist && tsc && npm run copy:dist

clean:
	npm run clean:dist

lint:
	./node_modules/.bin/eslint ./test ./lib/nats.js ./examples ./benchmark

test: clean build
	npm run test

# Use 'npm run cover' instead
#test-cov:
#	@NODE_ENV=test ./node_modules/.bin/istanbul cover \
#	./node_modules/mocha/bin/mocha -- -R spec --slow 5000

# Use 'npm run coveralls' instead
#test-coveralls:
#	echo TRAVIS_JOB_ID $(TRAVIS_JOB_ID)
#	$(MAKE) lint
#	$(MAKE) test
#	@NODE_ENV=test ./node_modules/.bin/istanbul cover \
#	./node_modules/mocha/bin/_mocha --report lcovonly -- -R spec --slow 5000 && \
#	  cat ./coverage/lcov.info | ./node_modules/coveralls/bin/coveralls.js || true

.PHONY: test
