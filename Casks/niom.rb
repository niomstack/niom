# Homebrew Cask formula for NIOM
# Auto-updated by the build-release workflow after each release.
#
# Users install with:
#   brew tap niomstack/niom https://github.com/niomstack/niom
#   brew install --cask niom

cask "niom" do
  version "0.1.5"

  if Hardware::CPU.intel?
    url "https://github.com/niomstack/niom/releases/download/niom-v#{version}/niom_#{version}_x64.dmg"
    sha256 "aed0eb339467bcd1218747072cdf2c2d788e4ba98276031bda7eab1a3c236d6d"
  else
    url "https://github.com/niomstack/niom/releases/download/niom-v#{version}/niom_#{version}_aarch64.dmg"
    sha256 "ec80a2992ff811129a5913e3795da2c5f46bf5fca2b2699a80c1e2614a822b1d"
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
