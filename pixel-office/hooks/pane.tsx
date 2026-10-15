import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { emptyScene, restore } from './model'
import { STATUS_WORDS, agentDetails, altText, clockLabel, objectiveLine, orgRows, renderOffice } from './render'
import { PANE } from './state'
import { STATIONS, STATION_ORDER } from './stations'

const ORG_MAX = 14
const sceneAtom = atom({ plugin: 'pixel-office', key: 'scene' } as const, emptyScene())
const legendAtom = atom({ plugin: 'pixel-office', key: 'legendOpen' } as const, false)
const selectedAtom = atom({ plugin: 'pixel-office', key: 'selected' } as const, null as string | null)
const clockAtom = atom({ plugin: 'pixel-office', key: 'clock' } as const, 0)
// Coordinating wears the meeting room's teal: a boss waiting on its helpers, not on you.
const STATUS_COLOR = { working: 'green', coordinating: STATIONS.meeting.color, waiting: 'yellow', idle: 'gray', done: 'gray' } as const

export function registerPane(on: On): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const scene = restore(await read($, sceneAtom))
    const isLegendOpen = await read($, legendAtom)
    const selected = await read($, selectedAtom)
    // Reading the clock atom subscribes the pane to it: each write from the flush timer redraws the pane.
    const now = Math.max(await $.clock.now(), await read($, clockAtom))
    const rows = orgRows(scene)
    const shown = rows.slice(0, ORG_MAX)
    const hidden = rows.length - shown.length
    const details = selected === null ? [] : agentDetails(scene, selected, now)

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text dimColor>Open this session in the Claude desktop app to see the pixel office.</Text>
          {shown.map(row => {
            const objective = objectiveLine(scene, row.id, row.depth, e.props.bodyColumns)
            return (
              <Box key={`row-${row.id}`} flexDirection="column">
                <Text wrap="truncate-end">
                  {'  '.repeat(row.depth)}
                  {row.label}: {STATUS_WORDS[row.status]}, {row.now}
                </Text>
                {objective !== '' && <Text dimColor>{objective}</Text>}
              </Box>
            )
          })}
          {scene.ticker.map(line => (
            <Text dimColor>
              {clockLabel(line.at)} {line.text}
            </Text>
          ))}
        </Box>
      )
    }

    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    const orgWidth = Math.max(24, Math.min(40, Math.floor(e.props.bodyColumns / 2)))
    return (
      <Box flexDirection="column" gap={1}>
        <Svg source={renderOffice(scene, now)} alt={altText(scene)} />
        <Box flexDirection="row" gap={2}>
          <Box key="ticker" flexDirection="column" flexGrow={1}>
            <Text bold>What's happening</Text>
            {scene.ticker.length === 0 && <Text dimColor>Quiet so far. Agents appear as they start working.</Text>}
            {scene.ticker.map(line => (
              <Text wrap="truncate-end">
                {clockLabel(line.at)} {line.text}
              </Text>
            ))}
          </Box>
          <Box key="org" flexDirection="column" width={orgWidth}>
            <Text bold>Who's doing what</Text>
            {shown.map(row => {
              const objective = objectiveLine(scene, row.id, row.depth, orgWidth)
              return (
                <Box key={`row-${row.id}`} flexDirection="column">
                  <Button
                    key={`agent-${row.id}`}
                    plain
                    onPress={() => update($, selectedAtom, current => (current === row.id ? null : row.id))}
                  >
                    <Text color={STATUS_COLOR[row.status]} dimColor={row.status === 'done'} wrap="truncate-end">
                      {'  '.repeat(row.depth)}
                      {row.label} · {STATUS_WORDS[row.status]} · {row.now}
                    </Text>
                  </Button>
                  {objective !== '' && (
                    <Text color={row.status === 'done' ? 'gray' : undefined} dimColor>
                      {objective}
                    </Text>
                  )}
                </Box>
              )
            })}
            {hidden > 0 && <Text dimColor>+{hidden} more</Text>}
            {details.length > 0 && (
              <Box key="details" flexDirection="column" marginTop={1}>
                {details.map(line => (
                  <Text dimColor>{line}</Text>
                ))}
              </Box>
            )}
          </Box>
        </Box>
        <Button
          key="legend"
          label={isLegendOpen ? 'Hide legend' : 'Show legend'}
          onPress={() => update($, legendAtom, isOpen => !isOpen)}
        />
        {isLegendOpen && (
          <Box key="legend-list" flexDirection="column">
            {STATION_ORDER.map(id => (
              <Text color={STATIONS[id].color}>
                ■ {STATIONS[id].name}: {STATIONS[id].tools}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
