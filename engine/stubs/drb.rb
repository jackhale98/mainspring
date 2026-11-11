# SPDX-License-Identifier: GPL-2.0-or-later
#
# drb.rb - browser stand-in for Ruby's drb library (ported from poc/stubs/drb.rb).
#
# The browser build has no sockets. TaskJuggler requires 'drb' in TaskJuggler.rb
# but only uses DRb for its tj3d/tj3client daemon, which Mainspring does not
# run. Only the DRbUndumped marker module is defined.
#
# Loaded only in the browser bundle. The native golden recorder uses the real
# drb gem pinned in engine/golden/Gemfile.lock.
module DRb
  module DRbUndumped; end
end
DRbUndumped = DRb::DRbUndumped unless defined?(DRbUndumped)
