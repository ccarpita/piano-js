#!/bin/bash -xe

get-samples() {
  mkdir -p tmp
  cd tmp
  local base_url='http://theremin.music.uiowa.edu'
  local IFS='
'
  for aiff in $(curl "${base_url}/MISpiano.html" | pup 'a[href] attr{href}' | grep aiff | sed 's/ /%20/g'); do
    curl -O "$base_url/$aiff"
  done
  cd ..
}
get-samples
exit $?
