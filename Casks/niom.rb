# Homebrew Cask formula for NIOM
# Auto-updated by the build-release workflow after each release.
#
# Users install with:
#   brew tap niomstack/niom https://github.com/niomstack/niom
#   brew install --cask niom

cask "niom" do
  version "0.1.7"

  if Hardware::CPU.intel?
    url "https://github.com/niomstack/niom/releases/download/niom-v#{version}/niom_#{version}_x64.dmg"
    sha256 "8e1f668d0abb6dc08bdf8da60b313fe130aaff484599f40255b0f1f0949ea0d9"
  else
    url "https://github.com/niomstack/niom/releases/download/niom-v#{version}/niom_#{version}_aarch64.dmg"
    sha256 "df7d72afd74c8d744bd7913456577d7097a97091d24fec991a80c572ca1e329c"
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
