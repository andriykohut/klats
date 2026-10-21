GOLANGCI_LINT = go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0

.PHONY: check lint test typecheck web gen e2e dev

check: lint test typecheck

lint:
	$(GOLANGCI_LINT) run
	cd web && pnpm install && pnpm exec biome check --no-errors-on-unmatched ..

test:
	go test ./...

typecheck:
	cd web && pnpm install && pnpm -r --if-present typecheck

web:
	cd web && pnpm install && pnpm -r --if-present build

# sqlc and tygo configs are added with the first query and shared types.
gen:
	@echo "gen: nothing to generate yet"

# Playwright end-to-end tests are added later.
e2e:
	@echo "e2e: no end-to-end tests yet"

dev:
	go run -tags nodesktop ./cmd/klats -dev
