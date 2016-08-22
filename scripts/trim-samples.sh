#!/bin/bash -xe

THRESHOLD_DB="-50"

trim-samples() {
  cd samples
  for file in $(ls *.aiff | grep -v trimmed); do
    ffmpeg -y -i "$file" -af "silenceremove=1:0:${THRESHOLD_DB}dB"  $(basename $file .aiff).trimmed.aiff
  done
  cd ..
}
trim-samples
