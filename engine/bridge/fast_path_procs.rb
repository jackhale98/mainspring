# SPDX-License-Identifier: GPL-2.0-only
#
# Near-copy of TaskJuggler code: the two procs below repeat those that
# PropertyTreeNode#initialize installs on a node's attribute hashes
# (engine/tj/lib/taskjuggler/PropertyTreeNode.rb:58-85, TaskJuggler 3.8.4,
# Copyright (c) 2006-2014 by Chris Schlaeger, GPL-2.0-only), with the same
# lookups and errors. This file is therefore GPL-2.0-only, like TaskJuggler,
# not GPL-2.0-or-later like the rest of Mainspring (ADR-0001 addendum).
#
# fast_path_procs.rb - the fast path (fast_path.rb) keeps a Marshal copy of a
# parsed project. Marshal cannot dump a Hash with a default proc, so the copy
# is taken without them; this puts them back on every node of a loaded copy,
# bound to that node, so attributes created on demand behave as in a parse.
module MainspringBridge
  module FastPathProcs
    module_function

    # The nodes of every property set of _project_.
    def nodes(project)
      %i[@scenarios @shifts @accounts @resources @tasks @reports].flat_map do |iv|
        project.instance_variable_get(iv).instance_variable_get(:@properties)
      end
    end

    # The procs of PropertyTreeNode#initialize, bound to each node of _project_.
    def install(project)
      nodes(project).each do |n|
        n.instance_eval do
          @attributes.default_proc = proc do |hash, attributeId|
            unless (aType = attributeDefinition(attributeId))
              raise ArgumentError,
                    "Unknown attribute '#{attributeId}' requested for " \
                    "#{self.class.to_s.sub(/TaskJuggler::/, '')} '#{fullId}'"
            end
            raise ArgumentError, "Attribute '#{attributeId}' is scenario specific" if aType.scenarioSpecific

            hash[attributeId] = aType.objClass.new(@propertySet, aType, self)
          end
          @scenarioAttributes.each_with_index do |h, scenarioIdx|
            h.default_proc = proc do |hash, attributeId|
              unless (aType = attributeDefinition(attributeId))
                raise ArgumentError,
                      "Unknown attribute '#{attributeId}' requested for " \
                      "#{self.class.to_s.sub(/TaskJuggler::/, '')} '#{fullId}'"
              end
              raise ArgumentError, "Attribute '#{attributeId}' is not scenario specific" unless aType.scenarioSpecific

              hash[attributeId] = aType.objClass.new(@propertySet, aType, @data[scenarioIdx])
            end
          end
        end
      end
    end
  end
end
