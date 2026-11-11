require "tj_bridge"
puts JSON.generate(ARGV.map { |f| [File.basename(f), JSON.parse(TJBridge.run(File.read(f), "/tmp/x.tjp"))] })
