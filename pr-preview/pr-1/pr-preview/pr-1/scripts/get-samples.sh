#!/bin/bash -xe

download-file() {
  local file="$1"
  curl -H "Cache-Control: max-age=0" \
       -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.116 Safari/537.36" \
       -O "$file"
}

get-aiff-urls() {
  curl "${base_url}/MISpiano.html"\
    | pup 'a[href] attr{href}'\
    | grep Piano\
    | grep aiff\
    | grep ff\
    | sed 's/ /%20/g'
}

get-samples() {
  mkdir -p samples
  cd samples
  local base_url='http://theremin.music.uiowa.edu'
  local IFS='
'
  for aiff in $(get-aiff-urls); do
    download-file "$base_url/$aiff"
    sleep 2
  done
  cd ..
}
get-samples
exit $?
