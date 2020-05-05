import { Request, Response, Router } from 'express'
import { find } from '../../db/dao'
import { RECORD } from '../../db/model'

const router = Router()
export default router.get('/list', (req: Request, res: Response) => {
  find(RECORD).then(results => {
    res.json(results)
  }).catch(_ => {
    res.status(500).end()
  })
}) 