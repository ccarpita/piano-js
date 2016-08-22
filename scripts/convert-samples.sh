#!/bin/bash -ex

convert-samples() {
  local dest="../assets/audio/"
  cd samples
  for file in *.trimmed.aiff; do
    ffmpeg -y -i "$file" ${dest}$(basename "$file" .trimmed.aiff).ogg
    ffmpeg -y -i "$file" ${dest}$(basename "$file" .trimmed.aiff).mp3
  done
  cd ..
}
convert-samples
