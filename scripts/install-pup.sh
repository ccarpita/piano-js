#!/bin/bash
get-pup() {
  if type pup &>/dev/null; then
    return 0
  fi
  if type brew &>/dev/null; then
    brew install https://raw.githubusercontent.com/EricChiang/pup/master/pup.rb
  elif type go &>/dev/null; then
    go get github.com/ericchiang/pup
  else
    echo "Cannot get pup: need brew or go installed" >&2
    return 2
  fi
}
get-pup
exit $?
