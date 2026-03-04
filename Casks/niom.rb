# Homebrew Cask formula for NIOM
# Auto-updated by the build-release workflow after each release.
#
# Users install with:
#   brew tap niomstack/niom https://github.com/niomstack/niom
#   brew install --cask niom

cask "niom" do
  version "0.1.3"

  if Hardware::CPU.intel?
    url "https://github.com/niomstack/niom/releases/download/niom-v#{version}/niom_#{version}_x64.dmg"
    sha256 "66fe6bb3ca8d08be371e7a537a55f2c3edb0d6723ac5a201e6eed4cf4d78a7f6"
  else
    url "https://github.com/niomstack/niom/releases/download/niom-v#{version}/niom_#{version}_aarch64.dmg"
    sha256 "ec8f03e5802234932f87c4900fca2475832688c9f25b30519f66d8744fdc71ec"
  end

  name "NIOM"
  desc "Neural Interface Operating Model — Ambient AI Desktop Assistant"
  homepage "https://niom.dev"

  livecheck do
    url "https://github.com/niomstack/niom/releases/latest"
    regex(/niom-v(\d+(?:\.\d+)+)/i)
  end

  depends_on macos: ">= :monterey"

  app "niom.app"

  zap trash: [
    "~/.niom",
  ]
end
