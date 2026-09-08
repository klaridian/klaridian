# Homebrew formula for klaridian — TEMPLATE.
#
# This is the source of truth for the formula that lives in the tap repo
# `klaridian/homebrew-klaridian` (Formula/klaridian.rb). It downloads
# the PREBUILT binary from the GitHub Release — it does NOT `depends_on "node"`
# and does NOT build from source. That keeps `brew install` a zero-Node,
# instant install (the Speakeasy model, ARCHITECTURE.md §64).
#
# The url/sha256 per platform are filled in per release by
# packaging/homebrew/render-formula.sh from the release's binary assets.
# The __VERSION__ / __SHA_*__ placeholders below are substituted there.
class Klaridian < Formula
  desc "Generate MCP servers from an OpenAPI spec — native binary, no Node required"
  homepage "https://klaridian.dev"
  version "__VERSION__"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/klaridian/klaridian/releases/download/v__VERSION__/klaridian-darwin-arm64"
      sha256 "__SHA_DARWIN_ARM64__"
    end
    on_intel do
      url "https://github.com/klaridian/klaridian/releases/download/v__VERSION__/klaridian-darwin-x64"
      sha256 "__SHA_DARWIN_X64__"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/klaridian/klaridian/releases/download/v__VERSION__/klaridian-linux-arm64"
      sha256 "__SHA_LINUX_ARM64__"
    end
    on_intel do
      url "https://github.com/klaridian/klaridian/releases/download/v__VERSION__/klaridian-linux-x64"
      sha256 "__SHA_LINUX_X64__"
    end
  end

  def install
    # The downloaded asset is the bare binary; install it as `klaridian`.
    bin.install Dir["*"].first => "klaridian"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/klaridian --version")
  end
end
