import { Request, Response, Router } from 'express'
import { update } from '../../db/dao'
import { RACE } from '../../db/model'

const router = Router()
export default router.put('/update', (req: Request, res: Response) => {
  const data = req.body
  const { _id } = data
  if (!_id) {
    return res.status(400).end()
  }
  update(RACE, { _id }, data).then(_ => {
    res.status(200).end()
  }).catch(e => {
    res.status(500).end()
  })
})