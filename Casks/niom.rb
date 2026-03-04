# Homebrew Cask formula for NIOM
# Auto-updated by the build-release workflow after each release.
#
# Users install with:
#   brew tap niomstack/niom https://github.com/niomstack/niom
#   brew install --cask niom

cask "niom" do
  version "0.1.8"

  if Hardware::CPU.intel?
    url "https://github.com/niomstack/niom/releases/download/niom-v#{version}/niom_#{version}_x64.dmg"
    sha256 "473075adec42b1b779c4f2efe14ffad1edb437512b71ce73a52bf69e577ac542"
  else
    url "https://github.com/niomstack/niom/releases/download/niom-v#{version}/niom_#{version}_aarch64.dmg"
    sha256 "5e95bef62fafc96257bfb3614659a5897e942d61f87766ecf02b1a8ad9db06ab"
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
