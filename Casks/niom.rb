# Homebrew Cask formula for NIOM
# Auto-updated by the build-release workflow after each release.
#
# Users install with:
#   brew tap niomstack/niom https://github.com/niomstack/niom
#   brew install --cask niom

cask "niom" do
  version "0.1.2"

  if Hardware::CPU.intel?
    url "https://github.com/niomstack/niom/releases/download/niom-v#{version}/niom_#{version}_x64.dmg"
    sha256 "93cb0434d36c88bd0263cb3c43f06ed0782463cba837f291773f36892786e261"
  else
    url "https://github.com/niomstack/niom/releases/download/niom-v#{version}/niom_#{version}_aarch64.dmg"
    sha256 "defa8f29acb4ad4bbdeee70f583f9c628908d23c0b7e8a2a44351bd348656c41"
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
