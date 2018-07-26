.DEFAULT_GOAL := build

build:
	npm run clean:dist && tsc && npm run copy:dist

clean:
	npm run clean:dist

lint:
	./node_modules/.bin/eslint ./test ./lib/nats.js ./examples ./benchmark

test: clean build
	npm run test


.PHONY: test
