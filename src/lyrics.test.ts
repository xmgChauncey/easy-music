import { describe, expect, it } from 'vitest'
import { activeLyricIndex, parseLyrics } from './lyrics'

describe('parseLyrics', () => {
  it('解析 LRC 时间轴和偏移', () => {
    const lyrics = parseLyrics('[ar:歌手]\n[offset:500]\n[00:01.00]第一句\n[00:03.20][00:04.20]第二句')
    expect(lyrics.synced).toBe(true)
    expect(lyrics.lines).toEqual([
      { time: 1.5, text: '第一句' },
      { time: 3.7, text: '第二句' },
      { time: 4.7, text: '第二句' },
    ])
  })

  it('保留无时间轴的内嵌歌词', () => {
    expect(parseLyrics('第一句\n\n第二句')).toEqual({
      synced: false,
      lines: [{ time: null, text: '第一句' }, { time: null, text: '第二句' }],
    })
  })

  it('解析并隐藏增强型逐字时间标签', () => {
    const lyrics = parseLyrics([
      '<00:00.000>2002<00:00.830>年<00:01.660>的',
      '<00:02.490>第<00:03.320>一<00:04.150>场',
      '<00:00.000><00:09.970>词<00:12.462>：',
      '<00:14.954>刀<00:17.446>郎',
    ].join('\n'))
    expect(lyrics).toEqual({
      synced: true,
      lines: [
        { time: 0, text: '2002年的' },
        { time: 2.49, text: '第一场' },
        { time: 9.97, text: '词：' },
        { time: 14.954, text: '刀郎' },
      ],
    })
  })

  it('根据进度选择当前歌词', () => {
    const lines = parseLyrics('[00:01]第一句\n[00:05]第二句').lines
    expect(activeLyricIndex(lines, 4)).toBe(0)
    expect(activeLyricIndex(lines, 5)).toBe(1)
  })
})
