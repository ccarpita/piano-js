#!/bin/bash -e

convert-samples() {
  cd tmp
  if ! type ffmpeg >/dev/null; then
    return 1
  fi
  for file in *.aiff; do
    ffmpeg -i "$file" $(basename "$file" .aiff).ogg
  done
  cd ..
}
convert-samples
