import { Request, Response, Router } from 'express';
import { getUserModel, likeQuery, sequelize } from '@/db/model';
import { compact, set, toNumber } from 'lodash';
import { compareSync } from 'bcryptjs';
import { check } from '@/middlewares/auth-check';

const router = Router();

router.get('/get_user', async (req: Request, res: Response) => {
  const { identity, account } = req.user;
  const UserModel = getUserModel(identity);
  const user = await UserModel.findByPk(account, {
    attributes: { exclude: ['password', 'create_time', 'update_time'] },
  });
  res.json({
    code: 200,
    msg: 'success',
    data: Object.assign({}, user?.toJSON(), req.user),
  });
});

router.post('/user/add', async (req: Request, res: Response) => {
  const { type, data } = req.body;
  if (!type || !data) {
    return res400(res);
  }
  const [exists] = await checkUser(type, [data]);
  if (exists.length !== 0) {
    return res.json({
      code: 1,
      msg: '用户已存在',
    });
  }
  const UserModel = getUserModel(type);
  await UserModel.create(data);
  res.json({
    code: 200,
    msg: '添加成功',
  });
});

router.post('/user/import', async (req: Request, res: Response) => {
  const { type, data = [] } = req.body;
  if (!type || !data.length) {
    return res400(res);
  }
  const [exists, unexists] = await checkUser(type, data);
  console.log(exists, unexists);

  const UserModel = getUserModel(type);

  await sequelize.transaction(async transaction => {
    await UserModel.bulkCreate(unexists, { transaction, validate: true });
  });

  if (exists.length !== 0) {
    return res.json({
      code: 1,
      msg: '用户已存在',
      data: exists,
    });
  }

  res.json({
    code: 200,
    msg: '添加成功',
  });
});

router.delete('/user/delete', async (req: Request, res: Response) => {
  const { type, data } = req.body;
  if (!Array.isArray(data.ids)) {
    return res400(res);
  }
  const { account, identity } = req.user;
  if (data.ids.includes(account) && type === identity) {
    return res.json({
      code: 400,
      msg: '不能删除自己',
    });
  }
  const UserModal = getUserModel(type);
  await UserModal.destroy({
    where: { [UserModal.primaryKeyAttribute]: data.ids },
  });
  res.json({
    code: 200,
    msg: '删除成功',
  });
});

router.get('/user/list', async (req: Request, res: Response) => {
  const {
    type,
    offset,
    limit,
    name,
    class: className,
    ...query
  } = req.query;

  Object.assign(query, likeQuery({
    name,
    class: className,
  }));

  const Modal = getUserModel(type as string);
  const { rows, count } = await Modal.findAndCountAll({
    attributes: { exclude: ['password'] },
    where: query,
    order: [['create_time', 'DESC']],
    limit: toNumber(limit) || undefined,
    offset: toNumber(limit) * (toNumber(offset) - 1) || undefined,
  });
  res.json({
    code: 200,
    msg: '查询成功',
    count,
    data: rows.map(item => item.toJSON()),
  });
});

router.patch('/user/password', async (req: Request, res: Response) => {
  const { account, identity, oldVal, newVal } = req.body;
  const target: string[] = [account, identity, oldVal, newVal];
  const { length } = compact(target); // 空值检测
  if (length !== target.length) {
    return res400(res);
  }
  const UserModal = getUserModel(identity);
  const user = await UserModal.findByPk(account);
  if (!user) {
    return res.json({
      code: 2,
      msg: '用户不存在',
    });
  }
  // 无匹配记录
  if (!compareSync(oldVal, user.getDataValue('password'))) {
    return res.json({
      code: 1,
      msg: '原密码有误',
    });
  }
  // 新密码加密后更新
  await UserModal.update({ password: newVal }, {
    where: { [UserModal.primaryKeyAttribute]: account },
  });
  res.json({
    code: 200,
    msg: '修改成功',
  });
});

router.put('/user/reset', async (req: Request, res: Response) => {
  const { type, account } = req.body;
  const UserModel = getUserModel(type);
  // 重置密码
  await UserModel.update({ password: '123456' }, {
    where: { [UserModel.primaryKeyAttribute]: account },
  });
  res.json({
    code: 200,
    msg: '重置成功',
  });
});

const checkUserUpdate = check('user:update');
router.put('/user/update', async (req: Request, res: Response) => {
  const { type, data } = req.body;
  if (!type || !data) {
    return res400(res);
  }

  const UserModel = getUserModel(type);
  const key = UserModel.primaryKeyAttribute;
  const { [key]: account, ...otherAttrs } = data;
  delete otherAttrs.password; // 密码修改使用单独的接口

  const isSelf = account === req.user.account && req.user.identity === type;
  const isPass = isSelf || checkUserUpdate(req);
  if (!isPass) {
    return res.json({
      code: 401,
      msg: '暂无权限',
    });
  }
  await UserModel.update(otherAttrs, { where: { [key]: account } });
  res.json({
    code: 200,
    msg: '修改成功',
  });
});

export default router;

function res400(res: Response) {
  return res.json({
    code: 400,
    msg: '参数有误',
  });
}

/**
 * 判断用户是否已存在
 * @param type 用户类型
 * @param users 用户数据
 */
function checkUser(type: 'student' | 'teacher', users: any[]) {
  return new Promise<[Array<object>, Array<object>]>((resolve, reject) => {
    const model = getUserModel(type);
    const key = model.primaryKeyAttribute;
    model.findAll({
      where: { [key]: users.map(item => item[key]) },
      attributes: { exclude: ['password'] },
    }).then((exist = []) => {
      const accounts = new Set();
      resolve([
        // 第一个参数是已存在的用户
        exist.map(item => {
          accounts.add(item.getDataValue(key));
          return item.toJSON();
        }),
        // 第二个参数是不存在的、待添加的用户
        users.filter(user => {
          if (accounts.has(user[key])) return false;
          // 设置默认身份 role_id为3是学生、4是教师
          set(user, 'role_id', type === 'student' ? 3 : 4);
          return true;
        }),
      ]);
    }).catch(reject);
  });
}
