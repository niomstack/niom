# Changelog

## [0.1.3](https://github.com/niomstack/niom/compare/niom-v0.1.2...niom-v0.1.3) (2026-03-04)


### Bug Fixes

* update sidecar config, add skill tree traversal ([7b87019](https://github.com/niomstack/niom/commit/7b87019d38416bd59c93e95bc3495c58f2d2c49a))

## [0.1.2](https://github.com/niomstack/niom/compare/niom-v0.1.1...niom-v0.1.2) (2026-03-02)


### Bug Fixes

* add auto updater plugin ([4e084ce](https://github.com/niomstack/niom/commit/4e084ce773ef5c651148d59e2752f26b89ca864b))
* chain release-please to build-release via workflow_call, add workflow_dispatch trigger ([a0e9aee](https://github.com/niomstack/niom/commit/a0e9aeee0c989b69663533c3acc8482283754303))
* skip macOS notarization when APPLE_TEAM_ID secret is not set ([79024c5](https://github.com/niomstack/niom/commit/79024c58de03d65213df9860f317b646ebc76eda))
* use ad-hoc signing (-) for macOS when no certificate is configured ([f110f29](https://github.com/niomstack/niom/commit/f110f290fe21202ed538b1c3faf553030135a2bb))
* use macos-15 runner, add shell:bash for Windows tag resolution ([6caa851](https://github.com/niomstack/niom/commit/6caa851bc6b097d571a1bc596009a531ade5ee41))

## [0.1.1](https://github.com/niomstack/niom/compare/niom-v0.1.0...niom-v0.1.1) (2026-03-02)


### Features

* initial commit ([e9a4ac6](https://github.com/niomstack/niom/commit/e9a4ac663b9625fd33e2d518a39c0cf3845ecabb))


### Bug Fixes

* remove Windows CFLAGS leaking into Linux CI, add pkg-config + sidecar stub ([49ab624](https://github.com/niomstack/niom/commit/49ab6243fcfdf15fb13fdc1fa8102875f49aed05))
