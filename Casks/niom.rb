# Homebrew Cask formula for NIOM
# This file is auto-updated by the update-manifests workflow after each release.
#
# Users install with:
#   brew tap niomstack/niom https://github.com/niomstack/niom
#   brew install --cask niom

cask "niom" do
  version "__VERSION__"

  if Hardware::CPU.intel?
    url "https://github.com/niomstack/niom/releases/download/v#{version}/niom_#{version}_x64.dmg"
    sha256 "__SHA256_INTEL__"
  else
    url "https://github.com/niomstack/niom/releases/download/v#{version}/niom_#{version}_aarch64.dmg"
    sha256 "__SHA256_ARM__"
  end

  name "NIOM"
  desc "Neural Interface Operating Model — Ambient AI Desktop Assistant"
  homepage "https://niom.dev"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :monterey"

  app "NIOM.app"

  zap trash: [
    "~/.niom",
  ]
end
