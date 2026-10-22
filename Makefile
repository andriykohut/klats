GOLANGCI_LINT = go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0

# Go 1.27 links its own code for macOS 13 or later, while Wails' cgo flags ask
# for 10.13 and its other C files default to the SDK's version; agreeing on
# 13.0 keeps the macOS linker from warning.
ifeq ($(shell uname -s),Darwin)
export MACOSX_DEPLOYMENT_TARGET := 13.0
export CGO_LDFLAGS := $(or $(CGO_LDFLAGS),-O2 -g) -mmacosx-version-min=13.0
endif

.PHONY: build check lint test typecheck web gen e2e dev

build:
	go build ./cmd/klats

check: lint test typecheck

lint:
	$(GOLANGCI_LINT) run
	cd web && pnpm install && pnpm exec biome check --no-errors-on-unmatched ..

test:
	go test ./...
	cd web && pnpm install && pnpm -r --if-present test

typecheck:
	cd web && pnpm install && pnpm -r --if-present typecheck

web:
	cd web && pnpm install && pnpm -r --if-present build

gen:
	go tool sqlc generate
	go tool tygo generate

# Playwright end-to-end tests are added later.
e2e:
	@echo "e2e: no end-to-end tests yet"

dev:
	go run -tags nodesktop ./cmd/klats -dev
