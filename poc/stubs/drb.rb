# The browser build has no sockets. TaskJuggler only uses DRb for its
# tj3d/tj3client daemon, which this front end does not need.
module DRb
  module DRbUndumped; end
end
DRbUndumped = DRb::DRbUndumped unless defined?(DRbUndumped)
