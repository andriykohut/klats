GOLANGCI_LINT = go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0

# Go 1.27 links its own code for macOS 13 or later, while Wails' cgo flags ask
# for 10.13 and its other C files default to the SDK's version; agreeing on
# 13.0 keeps the macOS linker from warning.
ifeq ($(shell uname -s),Darwin)
export MACOSX_DEPLOYMENT_TARGET := 13.0
export CGO_LDFLAGS := $(or $(CGO_LDFLAGS),-O2 -g) -mmacosx-version-min=13.0
endif

.PHONY: build check lint test typecheck size web gen e2e load dev demo

build:
	go build ./cmd/klats

check: lint test typecheck size

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

# The student app's JS, gzipped, must stay within 350 KB: thirty lab PCs load
# it at once over the school network. Checked only when a build exists.
STUDENT_JS_BUDGET = 358400

size:
	@if [ ! -f web/student/dist/index.html ]; then echo "size: no student build, skipped"; exit 0; fi; \
	total=0; for f in web/student/dist/assets/*.js; do total=$$((total + $$(gzip -c "$$f" | wc -c))); done; \
	echo "size: student JS is $$total bytes gzipped (budget $(STUDENT_JS_BUDGET))"; \
	if [ $$total -gt $(STUDENT_JS_BUDGET) ]; then echo "size: student JS is over the 350 KB gzip budget"; exit 1; fi

gen:
	go tool sqlc generate
	go tool tygo generate

# The Playwright specs in web/e2e, in Chromium and Firefox. Their global setup
# builds the klats binary, which embeds the web apps built here.
e2e: web
	cd web && pnpm --filter @klats/e2e exec playwright test

# A lesson at full size against the sitting engine: 40 students for a minute.
load:
	go test -tags load -run Load -count=1 ./internal/sitting/

dev:
	go run -tags nodesktop ./cmd/klats -dev

# A lesson to try both apps on: class 7-Б, a six-question test and a running
# sitting, in a temporary data folder removed on exit. It prints the student
# address with the join code, and the teacher address.
demo: web
	go run -tags nodesktop ./cmd/klats -dev -demo
