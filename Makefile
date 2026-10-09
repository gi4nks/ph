all: build

dev:
	npm run dev

build:
	npm run build

start:
	node dist/cli.js

install: build
	npm install -g . --force

test:
	npm run test

clean:
	rm -rf dist

release-patch:
	npm version patch --no-git-tag-version

release-minor:
	npm version minor --no-git-tag-version

release-major:
	npm version major --no-git-tag-version

release: release-patch

.PHONY: all dev build start install test clean release-patch release-minor release-major release
